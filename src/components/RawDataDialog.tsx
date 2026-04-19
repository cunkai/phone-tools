import React from "react";
import { useTranslation } from "react-i18next";

interface RawDataDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  data: string;
}

const RawDataDialog: React.FC<RawDataDialogProps> = ({ open, onClose, title, data }) => {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-dark-800 border border-dark-700/50 rounded-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700/50">
          <h3 className="text-sm font-semibold text-dark-200">{title}</h3>
          <button onClick={onClose} className="text-dark-400 hover:text-dark-200 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-4 text-xs text-dark-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
          {data || t("common.noData")}
        </pre>
        <div className="px-4 py-3 border-t border-dark-700/50 flex justify-end">
          <button
            onClick={() => { navigator.clipboard.writeText(data); }}
            className="px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-xs"
          >
            {t("common.copy")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RawDataDialog;
