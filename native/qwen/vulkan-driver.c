// The Vulkan driver of tts-server on an Android phone, linked into the program in place of the
// loader's entry points ggml's Vulkan backend names (vkGetInstanceProcAddr and the few it calls
// directly). Chosen once, at ggml's first call:
// - the system's Vulkan, when a device it gives has what ggml's backend needs: Vulkan 1.2 and 16-bit
//   storage buffers (without them qwentts.cpp ends at once: "Unsupported device");
// - else Mesa's Turnip (Adreno 6xx/7xx: Vulkan 1.3) carried beside the program as libsa_turnip.so
//   (SA_VULKAN_DRIVER: another path), opened as Android's loader opens a driver (its HAL module)
//   and used without the loader — this program is its own process, so no namespace keeps the
//   driver out — only on a Qualcomm GPU (/dev/kgsl-3d0) and when its device has the same (the
//   Adreno 640 has no 16-bit storage buffers under either driver);
// - else none: ggml is told Vulkan 1.0, gives up its backend and runs on the CPU.
// SA_VULKAN=cpu: none; SA_VULKAN=system / turnip: that one alone. The choice is said on stderr.
#include <dlfcn.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <vulkan/vulkan.h>

// Android's HAL module of a Vulkan driver (hardware/hardware.h, hardware/hwvulkan.h), as far as used.
struct hw_device;
struct hw_module_methods {
  int (*open)(const void *module, const char *id, struct hw_device **device);
};
struct hw_module {
  uint32_t tag;
  uint16_t module_api_version, hal_api_version;
  const char *id, *name, *author;
  struct hw_module_methods *methods;
  void *dso;
  uint64_t reserved[32 - 7];
};
struct hw_device {
  uint32_t tag, version;
  struct hw_module *module;
  uint64_t reserved[12];
  int (*close)(struct hw_device *device);
};
struct hwvulkan_device {
  struct hw_device common;
  PFN_vkEnumerateInstanceExtensionProperties EnumerateInstanceExtensionProperties;
  PFN_vkCreateInstance CreateInstance;
  PFN_vkGetInstanceProcAddr GetInstanceProcAddr;
};

static PFN_vkGetInstanceProcAddr chosen;
static PFN_vkCreateInstance create_instance;
static VkInstance last_instance;

static VKAPI_ATTR VkResult VKAPI_CALL version_1_0(uint32_t *version) {
  *version = VK_API_VERSION_1_0;
  return VK_SUCCESS;
}

/** No driver: Vulkan 1.0 and nothing else, so ggml leaves its backend out. */
static VKAPI_ATTR PFN_vkVoidFunction VKAPI_CALL none(VkInstance instance, const char *name) {
  (void)instance;
  return strcmp(name, "vkEnumerateInstanceVersion") ? NULL : (PFN_vkVoidFunction)version_1_0;
}

/** A device of Vulkan 1.2 or later with 16-bit storage buffers through `gipa`: its name in `name`. */
static int usable(PFN_vkGetInstanceProcAddr gipa, char *name, size_t size) {
  PFN_vkEnumerateInstanceVersion version =
      (PFN_vkEnumerateInstanceVersion)gipa(NULL, "vkEnumerateInstanceVersion");
  PFN_vkCreateInstance create = (PFN_vkCreateInstance)gipa(NULL, "vkCreateInstance");
  uint32_t api = VK_API_VERSION_1_0;
  if (!create || (version && version(&api) != VK_SUCCESS) || api < VK_API_VERSION_1_2) return 0;
  VkApplicationInfo app = {.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO,
                           .pApplicationName = "sprachanker-probe",
                           .apiVersion = VK_API_VERSION_1_2};
  VkInstanceCreateInfo info = {.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,
                               .pApplicationInfo = &app};
  VkInstance instance;
  if (create(&info, NULL, &instance) != VK_SUCCESS) return 0;
  PFN_vkEnumeratePhysicalDevices enumerate =
      (PFN_vkEnumeratePhysicalDevices)gipa(instance, "vkEnumeratePhysicalDevices");
  PFN_vkGetPhysicalDeviceProperties properties =
      (PFN_vkGetPhysicalDeviceProperties)gipa(instance, "vkGetPhysicalDeviceProperties");
  PFN_vkGetPhysicalDeviceFeatures2 features =
      (PFN_vkGetPhysicalDeviceFeatures2)gipa(instance, "vkGetPhysicalDeviceFeatures2");
  PFN_vkDestroyInstance destroy = (PFN_vkDestroyInstance)gipa(instance, "vkDestroyInstance");
  int found = 0;
  VkPhysicalDevice devices[8];
  uint32_t count = 8;
  if (enumerate && properties && features && enumerate(instance, &count, devices) >= 0) {
    for (uint32_t i = 0; i < count && !found; i++) {
      VkPhysicalDeviceProperties p;
      properties(devices[i], &p);
      VkPhysicalDevice16BitStorageFeatures storage = {
          .sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_16BIT_STORAGE_FEATURES};
      VkPhysicalDeviceFeatures2 all = {.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2,
                                       .pNext = &storage};
      if (p.apiVersion >= VK_API_VERSION_1_2) features(devices[i], &all);
      if (p.apiVersion >= VK_API_VERSION_1_2 && storage.storageBuffer16BitAccess) {
        snprintf(name, size, "%s, Vulkan %u.%u", p.deviceName, VK_API_VERSION_MAJOR(p.apiVersion),
                 VK_API_VERSION_MINOR(p.apiVersion));
        found = 1;
      }
    }
  }
  if (destroy) destroy(instance, NULL);
  return found;
}

static PFN_vkGetInstanceProcAddr system_vulkan(char *name, size_t size) {
  void *lib = dlopen("libvulkan.so", RTLD_NOW | RTLD_LOCAL);
  PFN_vkGetInstanceProcAddr gipa = lib ? (PFN_vkGetInstanceProcAddr)dlsym(lib, "vkGetInstanceProcAddr") : NULL;
  return gipa && usable(gipa, name, size) ? gipa : NULL;
}

/** libsa_turnip.so beside this program (the app's native library folder), or SA_VULKAN_DRIVER. */
static PFN_vkGetInstanceProcAddr turnip(char *name, size_t size) {
  if (access("/dev/kgsl-3d0", R_OK | W_OK) != 0) return NULL;
  char path[4096];
  const char *given = getenv("SA_VULKAN_DRIVER");
  if (given) {
    snprintf(path, sizeof path, "%s", given);
  } else {
    ssize_t n = readlink("/proc/self/exe", path, sizeof path - 32);
    if (n <= 0) return NULL;
    path[n] = 0;
    char *slash = strrchr(path, '/');
    if (!slash) return NULL;
    strcpy(slash + 1, "libsa_turnip.so");
  }
  void *lib = dlopen(path, RTLD_NOW | RTLD_LOCAL);
  if (!lib) {
    fprintf(stderr, "[vulkan] %s: %s\n", path, dlerror());
    return NULL;
  }
  struct hw_module *module = (struct hw_module *)dlsym(lib, "HMI");
  struct hw_device *device = NULL;
  if (!module || !module->methods || module->methods->open(module, "vk0", &device) != 0 || !device)
    return NULL;
  PFN_vkGetInstanceProcAddr gipa = ((struct hwvulkan_device *)device)->GetInstanceProcAddr;
  return gipa && usable(gipa, name, size) ? gipa : NULL;
}

static void choose(void) {
  const char *mode = getenv("SA_VULKAN");
  char name[300] = "";
  const char *which = "none";
  PFN_vkGetInstanceProcAddr gipa = NULL;
  if (!mode || strcmp(mode, "cpu") != 0) {
    if (!mode || strcmp(mode, "turnip") != 0) {
      gipa = system_vulkan(name, sizeof name);
      which = "system";
    }
    if (!gipa && (!mode || strcmp(mode, "system") != 0)) {
      gipa = turnip(name, sizeof name);
      which = "turnip";
    }
  }
  if (gipa) {
    fprintf(stderr, "[vulkan] %s driver: %s\n", which, name);
    create_instance = (PFN_vkCreateInstance)gipa(NULL, "vkCreateInstance");
    chosen = gipa;
  } else {
    fprintf(stderr, "[vulkan] no device ggml's Vulkan backend can use: the CPU\n");
    chosen = none;
  }
}

/** vkCreateInstance, the instance kept for the entry points looked up through it below. */
static VKAPI_ATTR VkResult VKAPI_CALL kept_instance(const VkInstanceCreateInfo *info,
                                                    const VkAllocationCallbacks *allocator,
                                                    VkInstance *instance) {
  VkResult result = create_instance(info, allocator, instance);
  if (result == VK_SUCCESS) last_instance = *instance;
  return result;
}

VKAPI_ATTR PFN_vkVoidFunction VKAPI_CALL vkGetInstanceProcAddr(VkInstance instance, const char *name) {
  static pthread_once_t once = PTHREAD_ONCE_INIT;
  pthread_once(&once, choose);
  if (chosen != none && !strcmp(name, "vkCreateInstance")) return (PFN_vkVoidFunction)kept_instance;
  if (!strcmp(name, "vkGetInstanceProcAddr")) return (PFN_vkVoidFunction)vkGetInstanceProcAddr;
  return chosen(instance, name);
}

/** An entry point of the instance ggml made. */
static PFN_vkVoidFunction instance_entry(const char *name) {
  PFN_vkVoidFunction f = vkGetInstanceProcAddr(last_instance, name);
  if (!f) {
    fprintf(stderr, "[vulkan] %s: not given\n", name);
    abort();
  }
  return f;
}

VKAPI_ATTR PFN_vkVoidFunction VKAPI_CALL vkGetDeviceProcAddr(VkDevice device, const char *name) {
  static PFN_vkGetDeviceProcAddr f;
  if (!f) f = (PFN_vkGetDeviceProcAddr)instance_entry("vkGetDeviceProcAddr");
  return f(device, name);
}

VKAPI_ATTR void VKAPI_CALL vkGetPhysicalDeviceFeatures2(VkPhysicalDevice device,
                                                        VkPhysicalDeviceFeatures2 *features) {
  static PFN_vkGetPhysicalDeviceFeatures2 f;
  if (!f) f = (PFN_vkGetPhysicalDeviceFeatures2)instance_entry("vkGetPhysicalDeviceFeatures2");
  f(device, features);
}

VKAPI_ATTR void VKAPI_CALL vkCmdCopyBuffer(VkCommandBuffer buffer, VkBuffer from, VkBuffer to,
                                           uint32_t count, const VkBufferCopy *regions) {
  static PFN_vkCmdCopyBuffer f;
  if (!f) f = (PFN_vkCmdCopyBuffer)instance_entry("vkCmdCopyBuffer");
  f(buffer, from, to, count, regions);
}
