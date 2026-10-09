// The mark of the model a profile uses (Settings → Speech: Whisper's and Qwen3-TTS's models).
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/ui/components/badge.tsx";

export function InUse() {
  const { t } = useTranslation();
  return (
    <Badge variant="secondary">
      <Check /> {t("speech.settings.inUse")}
    </Badge>
  );
}
