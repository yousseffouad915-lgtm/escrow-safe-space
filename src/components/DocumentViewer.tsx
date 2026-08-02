import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Loader2 } from "lucide-react";

import { getKycFileUrl, getReceiptUrl } from "@/lib/trustlaunch.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Clickable document thumbnail that opens the full image in a dialog.
 * Signed URLs are fetched lazily and only when the viewer is opened.
 */
export function DocumentViewer({
  path,
  bucket,
  label,
}: {
  path: string | null | undefined;
  bucket: "kyc" | "receipt";
  label: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const kycFn = useServerFn(getKycFileUrl);
  const receiptFn = useServerFn(getReceiptUrl);

  const q = useQuery({
    queryKey: ["docUrl", bucket, path],
    enabled: open && !!path,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      bucket === "kyc" ? kycFn({ data: { path: path! } }) : receiptFn({ data: { path: path! } }),
  });

  if (!path) return <span className="text-[10px] text-muted-foreground">{t("docs.missing")}</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-accent"
      >
        <FileText className="h-3.5 w-3.5" />
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-[240px] items-center justify-center">
            {q.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            {q.isError && <p className="text-xs text-destructive">{t("docs.failed")}</p>}
            {q.data && (
              <img
                src={q.data as string}
                alt={label}
                className="max-h-[70vh] w-full rounded-md object-contain"
              />
            )}
          </div>
          {q.data && (
            <a
              href={q.data as string}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline text-muted-foreground"
            >
              {t("docs.openNewTab")}
            </a>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
