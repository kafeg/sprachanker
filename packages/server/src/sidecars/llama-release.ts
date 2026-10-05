// The pinned llama.cpp release the built-in model runs on (06 "Downloads": sha256 pinned). Official
// builds from ggml-org; downloaded when the learner first turns the built-in model on.

export const LLAMA_BUILD = "b11430";

export interface EngineAsset {
  build: string;
  /** `<os>-<arch>`: engines of several machines can share one data root. */
  platform: string;
  url: string;
  file: string;
  size: number;
  sha256: string;
}

const ASSETS: Record<string, { name: string; size: number; sha256: string }> = {
  "darwin-arm64": {
    name: "macos-arm64.tar.gz",
    size: 11971255,
    sha256: "74887f462706d17b01ae701f1e3aa571afa7f629628445d9cdfac923b4fe5b74",
  },
  "darwin-x64": {
    name: "macos-x64.tar.gz",
    size: 11487400,
    sha256: "6fb60072de5c082c5d3fc5e20b7b2c30f6496a36757d6c70a541c55bd7a6803f",
  },
  "linux-x64": {
    name: "ubuntu-x64.tar.gz",
    size: 17693360,
    sha256: "1b898a3b23df35cc6c3e93c3adba5c63ec31d48bee8e5f30639e9372836ec2f2",
  },
  "linux-arm64": {
    name: "ubuntu-arm64.tar.gz",
    size: 13682382,
    sha256: "bf79c63d0bedebf3b26dcede1992ab65585dd2280e54a5d60196e7dd47a43f89",
  },
  "win32-x64": {
    name: "win-cpu-x64.zip",
    size: 19399499,
    sha256: "b608455b0109793f774537d63d15d4cf2098ddbc5b200ebc9a648e1d85369666",
  },
  "win32-arm64": {
    name: "win-cpu-arm64.zip",
    size: 12228804,
    sha256: "9e6620fd545c78f2f55bad508ee082b993c3065e7284e8ef5341936085320319",
  },
};

/** The release archive for this machine, or undefined where no official build exists. */
export function llamaAsset(
  platform: string = process.platform,
  arch: string = process.arch,
): EngineAsset | undefined {
  const key = `${platform}-${arch}`;
  const asset = ASSETS[key];
  if (!asset) return undefined;
  const file = `llama-${LLAMA_BUILD}-bin-${asset.name}`;
  return {
    build: LLAMA_BUILD,
    platform: key,
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/${file}`,
    file,
    size: asset.size,
    sha256: asset.sha256,
  };
}
