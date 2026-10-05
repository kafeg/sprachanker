// Models for the built-in runtime (llama.cpp, 07 "Built-in model"): GGUF files on Hugging Face, pinned
// by size and sha256. Only models whose licence allows local personal use without sign-in.

export interface LocalModel {
  id: string;
  title: string;
  /** Hugging Face repository and file. */
  repo: string;
  file: string;
  sizeBytes: number;
  sha256: string;
  /** Memory the model needs while running, roughly (weights + 8k context). */
  ramGb: number;
}

export const LOCAL_MODELS: LocalModel[] = [
  {
    id: "gemma-4-e2b",
    title: "Gemma 4 E2B",
    repo: "google/gemma-4-E2B-it-qat-q4_0-gguf",
    file: "gemma-4-E2B_q4_0-it.gguf",
    sizeBytes: 3349516256,
    sha256: "fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634",
    ramGb: 4.5,
  },
  {
    id: "gemma-4-e4b",
    title: "Gemma 4 E4B",
    repo: "google/gemma-4-E4B-it-qat-q4_0-gguf",
    file: "gemma-4-E4B_q4_0-it.gguf",
    sizeBytes: 5154941280,
    sha256: "676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee",
    ramGb: 6.5,
  },
  {
    id: "gemma-4-12b",
    title: "Gemma 4 12B",
    repo: "google/gemma-4-12B-it-qat-q4_0-gguf",
    file: "gemma-4-12b-it-qat-q4_0.gguf",
    sizeBytes: 6975879296,
    sha256: "93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b",
    ramGb: 9,
  },
  {
    id: "gemma-4-26b-a4b",
    title: "Gemma 4 26B A4B",
    repo: "unsloth/gemma-4-26B-A4B-it-qat-GGUF",
    file: "gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf",
    sizeBytes: 14249047104,
    sha256: "a7c5bc715f5ff8e99a3e8901ce7d2b42b402c669bf24f7c5250747633d0f5891",
    ramGb: 17,
  },
];

export const localModelUrl = (m: LocalModel) =>
  `https://huggingface.co/${m.repo}/resolve/main/${m.file}`;

/** The largest model that leaves at least half of the computer's memory free. */
export function recommendedLocalModel(memoryGb: number): LocalModel | undefined {
  return LOCAL_MODELS.filter((m) => m.ramGb <= memoryGb / 2).at(-1) ?? LOCAL_MODELS[0];
}
