import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";

interface InputDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

const InputDialog: React.FC<InputDialogProps> = ({
  isOpen,
  title,
  message,
  placeholder = "",
  defaultValue = "",
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, defaultValue]);

  const handleConfirm = () => {
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleConfirm();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] animate-fade-in"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="bg-dark-800 border border-dark-600 rounded-xl p-6 w-96 shadow-2xl animate-slide-in">
        <h3 className="text-lg font-semibold text-dark-100 mb-2">{title}</h3>
        <p className="text-sm text-dark-400 mb-4 leading-relaxed">{message}</p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full px-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-dark-100 text-sm focus:outline-none focus:border-accent-500/50 mb-6"
        />
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm"
          >
            {cancelText || t("common.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!value.trim()}
            className="px-4 py-2 rounded-lg bg-accent-500 text-white text-sm font-medium transition-colors hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirmText || t("common.ok")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InputDialog;