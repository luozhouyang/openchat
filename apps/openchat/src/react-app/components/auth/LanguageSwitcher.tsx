import { useTranslation } from "react-i18next";
import { setLanguage } from "../../i18n";
import { Button } from "../ui/button";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current: "en" | "zh" = i18n.language?.startsWith("zh") ? "zh" : "en";
  return (
    <div className="flex items-center gap-1">
      <Button
        variant={current === "en" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => setLanguage("en")}
      >
        English
      </Button>
      <Button
        variant={current === "zh" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => setLanguage("zh")}
      >
        中文
      </Button>
    </div>
  );
}
