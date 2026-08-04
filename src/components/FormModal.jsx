import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function FormModal({ open, onClose, title, onSubmit, submitLabel = "Simpan", submitting, children, size = "lg" }) {
  const sizeClass = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size] || "max-w-lg";
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={sizeClass}>
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold">{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
          <div className="space-y-3.5 py-2 max-h-[60vh] overflow-y-auto">
            {children}
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Batal</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Menyimpan..." : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}