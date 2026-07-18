import { useEffect, type ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import i18n, { applyDirection } from "./index";

function DirSync() {
  const { i18n: i } = useTranslation();
  useEffect(() => {
    applyDirection(i.language);
  }, [i.language]);
  return null;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <DirSync />
      {children}
    </I18nextProvider>
  );
}

export function useLanguage() {
  const { i18n: i } = useTranslation();
  return {
    lang: i.language,
    setLang: (l: "en" | "ar") => {
      i.changeLanguage(l);
      applyDirection(l);
    },
  };
}
