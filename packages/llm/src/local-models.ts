// Models for the built-in runtime (07 "Built-in model"), in the format of each engine: GGUF for llama.cpp,
// MLX for mlx-lm (Apple Silicon). Files on Hugging Face pinned by size and sha256; only models whose
// licence allows local personal use without sign-in. The MLX builds are the ones LM Studio downloads,
// so a copy already in LM Studio can be reused.

export type ModelFormat = "gguf" | "mlx";

export interface ModelFile {
  /** Path inside the repository. */
  path: string;
  size: number;
  sha256: string;
}

export interface ModelBuild {
  /** Hugging Face repository. */
  repo: string;
  files: ModelFile[];
}

export interface LocalModel {
  id: string;
  title: string;
  /** Memory the model needs while running, roughly (weights + 8k context). */
  ramGb: number;
  gguf: ModelBuild;
  mlx?: ModelBuild;
}

export const LOCAL_MODELS: LocalModel[] = [
  {
    id: "gemma-4-e2b",
    title: "Gemma 4 E2B",
    ramGb: 4.5,
    gguf: {
      repo: "google/gemma-4-E2B-it-qat-q4_0-gguf",
      files: [
        {
          path: "gemma-4-E2B_q4_0-it.gguf",
          size: 3349516256,
          sha256: "fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634",
        },
      ],
    },
    mlx: {
      repo: "lmstudio-community/gemma-4-E2B-it-MLX-4bit",
      files: [
        {
          path: "chat_template.jinja",
          size: 16317,
          sha256: "781d10940fbc44be40064b5d43a056fc486c84ceaa55538226368b57314132bf",
        },
        {
          path: "config.json",
          size: 31206,
          sha256: "7bb97d083794a22b94c8481558ac9a7f99d72eb330c2d1e5b3a701255abb0425",
        },
        {
          path: "generation_config.json",
          size: 208,
          sha256: "d4226bbe3117d2d253ba4609720ba82c6c4ce4627a9a6ae05387c78983ac03de",
        },
        {
          path: "model.safetensors",
          size: 4339886573,
          sha256: "54dfb6c99a9778a68dd5f3300f13930e65b567dab1ac54340001086bcf65a692",
        },
        {
          path: "model.safetensors.index.json",
          size: 230503,
          sha256: "08f854b97fefc68d39c0d2066240e3c9efdf76b9255c18da3065f91cafd01b5d",
        },
        {
          path: "processor_config.json",
          size: 902,
          sha256: "1bd0d00776284f369c1eff5fb631e865dfcdca861e0b7d60dbef27fcf37436a8",
        },
        {
          path: "tokenizer.json",
          size: 32169626,
          sha256: "cc8d3a0ce36466ccc1278bf987df5f71db1719b9ca6b4118264f45cb627bfe0f",
        },
        {
          path: "tokenizer_config.json",
          size: 21700,
          sha256: "16f4a5a617a11af24b4bf474109800989e7d2b5b1ca22f73a561ec2398308e8d",
        },
      ],
    },
  },
  {
    id: "gemma-4-e4b",
    title: "Gemma 4 E4B",
    ramGb: 6.5,
    gguf: {
      repo: "google/gemma-4-E4B-it-qat-q4_0-gguf",
      files: [
        {
          path: "gemma-4-E4B_q4_0-it.gguf",
          size: 5154941280,
          sha256: "676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee",
        },
      ],
    },
    mlx: {
      repo: "lmstudio-community/gemma-4-E4B-it-MLX-4bit",
      files: [
        {
          path: "chat_template.jinja",
          size: 16317,
          sha256: "781d10940fbc44be40064b5d43a056fc486c84ceaa55538226368b57314132bf",
        },
        {
          path: "config.json",
          size: 36493,
          sha256: "8b2b956fab049146585c693a08d1cd625cef8c84d8eb7ea556cf826d0565b92a",
        },
        {
          path: "generation_config.json",
          size: 208,
          sha256: "d4226bbe3117d2d253ba4609720ba82c6c4ce4627a9a6ae05387c78983ac03de",
        },
        {
          path: "model-00001-of-00002.safetensors",
          size: 4280494809,
          sha256: "e58e5ed66324cdc0ce22f51d4d71a9b2db8c24f666278d1b71c3440a18c0f163",
        },
        {
          path: "model-00002-of-00002.safetensors",
          size: 2548805689,
          sha256: "5ae9ab6d6e86dd4d8f7eb6957eb7ad151121431df3855516e89c185824d640cf",
        },
        {
          path: "model.safetensors.index.json",
          size: 295363,
          sha256: "edfcf22ac78bded1b0518358c2672596f9267d361c433fad7e593f7238bc15cb",
        },
        {
          path: "processor_config.json",
          size: 902,
          sha256: "1bd0d00776284f369c1eff5fb631e865dfcdca861e0b7d60dbef27fcf37436a8",
        },
        {
          path: "tokenizer.json",
          size: 32169626,
          sha256: "cc8d3a0ce36466ccc1278bf987df5f71db1719b9ca6b4118264f45cb627bfe0f",
        },
        {
          path: "tokenizer_config.json",
          size: 21700,
          sha256: "16f4a5a617a11af24b4bf474109800989e7d2b5b1ca22f73a561ec2398308e8d",
        },
      ],
    },
  },
  {
    id: "gemma-4-12b",
    title: "Gemma 4 12B",
    ramGb: 9,
    gguf: {
      repo: "google/gemma-4-12B-it-qat-q4_0-gguf",
      files: [
        {
          path: "gemma-4-12b-it-qat-q4_0.gguf",
          size: 6975879296,
          sha256: "93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b",
        },
      ],
    },
    mlx: {
      repo: "lmstudio-community/gemma-4-12B-it-MLX-4bit",
      files: [
        {
          path: "chat_template.jinja",
          size: 17466,
          sha256: "36e3a42e5cf14cd0020e72d92e1fdd9970f59b82170e421f0cbe1bb42bead3f0",
        },
        {
          path: "config.json",
          size: 5894,
          sha256: "677723368b4196b52549f1223ccaf91428ef03177766501ea2b9ce3ef6c410f1",
        },
        {
          path: "generation_config.json",
          size: 260,
          sha256: "a8349d9bd64cc5841297fcb5002f0fdc4749c473c8f1b10ea337f9ce4ee7014e",
        },
        {
          path: "model-00001-of-00002.safetensors",
          size: 5351756598,
          sha256: "47e8c872523dbdcd80f2fdca4953f3b1d027c9fca69f7c05338232732a3b5101",
        },
        {
          path: "model-00002-of-00002.safetensors",
          size: 1389282881,
          sha256: "dd6fff693520d3e89ad07b9cf3db2369659485146ce13fda0bd7ad087c6acc7d",
        },
        {
          path: "model.safetensors.index.json",
          size: 135329,
          sha256: "9ac99e7a6cf3e4d40eb8df01644fe9c04036ace94f3389df35db9d9449758516",
        },
        {
          path: "processor_config.json",
          size: 868,
          sha256: "016a1db9c4f41ea0c61919c46855ea5e7c45c6e4ae4bfbedfb5b6bed79a2fe92",
        },
        {
          path: "tokenizer.json",
          size: 32169626,
          sha256: "cc8d3a0ce36466ccc1278bf987df5f71db1719b9ca6b4118264f45cb627bfe0f",
        },
        {
          path: "tokenizer_config.json",
          size: 21881,
          sha256: "922a1be5d9d281777ddcd3050f54deb9aebbefbac247523d8ca8eff0f2564103",
        },
      ],
    },
  },
  {
    id: "gemma-4-26b-a4b",
    title: "Gemma 4 26B A4B",
    ramGb: 17,
    gguf: {
      repo: "unsloth/gemma-4-26B-A4B-it-qat-GGUF",
      files: [
        {
          path: "gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf",
          size: 14249047104,
          sha256: "a7c5bc715f5ff8e99a3e8901ce7d2b42b402c669bf24f7c5250747633d0f5891",
        },
      ],
    },
    mlx: {
      repo: "lmstudio-community/gemma-4-26B-A4B-it-QAT-MLX-4bit",
      files: [
        {
          path: "chat_template.jinja",
          size: 18245,
          sha256: "29af862bccabb14b90a4ff951bcd14c33fe74b651c5f07fc7f2e9aa46a59fe7c",
        },
        {
          path: "config.json",
          size: 33376,
          sha256: "29910322dd085f45c8f95c6c0f1611b20f722d6f6c8394321b34817e98a972fa",
        },
        {
          path: "generation_config.json",
          size: 203,
          sha256: "b69207f9be617e982d13cc273cce6fd88c98dda99a4bdc5e2d52ffe0a0d9f0a9",
        },
        {
          path: "model-00001-of-00003.safetensors",
          size: 5275612587,
          sha256: "898863f0d5eba7153a9c9b9443aac1969809f2149e88481c725b6da40783f129",
        },
        {
          path: "model-00002-of-00003.safetensors",
          size: 5296718232,
          sha256: "2abdca76ed4a647cfe8af680908894e2709b4e1221ddbbbef1b1edb14f60e303",
        },
        {
          path: "model-00003-of-00003.safetensors",
          size: 5036507755,
          sha256: "a554f0fdb61bc9e510a5318e723a780c31434fd3e3dcdd3c16c700f835ade7b7",
        },
        {
          path: "model.safetensors.index.json",
          size: 176940,
          sha256: "5455e83705bbdd4e3702c7d4f9d49d4900e84533036628f74500538075dd5c80",
        },
        {
          path: "processor_config.json",
          size: 902,
          sha256: "1bd0d00776284f369c1eff5fb631e865dfcdca861e0b7d60dbef27fcf37436a8",
        },
        {
          path: "tokenizer.json",
          size: 32169626,
          sha256: "cc8d3a0ce36466ccc1278bf987df5f71db1719b9ca6b4118264f45cb627bfe0f",
        },
        {
          path: "tokenizer_config.json",
          size: 21874,
          sha256: "91fe431216b0e1ce89d685b47ff0dbf69175c2f962d396edc97844b077bdfab3",
        },
      ],
    },
  },
];

export const modelFileUrl = (build: ModelBuild, file: ModelFile) =>
  `https://huggingface.co/${build.repo}/resolve/main/${file.path}`;

export const buildSize = (build: ModelBuild) => build.files.reduce((sum, f) => sum + f.size, 0);

/** The largest model that leaves at least half of the computer's memory free. */
export function recommendedLocalModel(memoryGb: number): LocalModel | undefined {
  return LOCAL_MODELS.filter((m) => m.ramGb <= memoryGb / 2).at(-1) ?? LOCAL_MODELS[0];
}
