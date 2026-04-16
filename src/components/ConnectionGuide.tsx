import React from "react";
import { useTranslation } from "react-i18next";

interface ConnectionGuideProps {
  isOpen: boolean;
  onClose: () => void;
}

const steps = [
  {
    emoji: "1",
    titleKey: "guide.step1Title",
    descKey: "guide.step1Desc",
    icon: (
      <div className="w-12 h-12 rounded-full bg-accent-500/20 flex items-center justify-center text-accent-400 text-xl font-bold">
        1
      </div>
    ),
  },
  {
    emoji: "2",
    titleKey: "guide.step2Title",
    descKey: "guide.step2Desc",
    icon: (
      <div className="w-12 h-12 rounded-full bg-accent-500/20 flex items-center justify-center text-accent-400 text-xl font-bold">
        2
      </div>
    ),
  },
  {
    emoji: "3",
    titleKey: "guide.step3Title",
    descKey: "guide.step3Desc",
    icon: (
      <div className="w-12 h-12 rounded-full bg-accent-500/20 flex items-center justify-center text-accent-400 text-xl font-bold">
        3
      </div>
    ),
  },
  {
    emoji: "4",
    titleKey: "guide.step4Title",
    descKey: "guide.step4Desc",
    icon: (
      <div className="w-12 h-12 rounded-full bg-accent-500/20 flex items-center justify-center text-accent-400 text-xl font-bold">
        4
      </div>
    ),
  },
  {
    emoji: "5",
    titleKey: "guide.step5Title",
    descKey: "guide.step5Desc",
    icon: (
      <div className="w-12 h-12 rounded-full bg-accent-500/20 flex items-center justify-center text-accent-400 text-xl font-bold">
        5
      </div>
    ),
  },
];

const ConnectionGuide: React.FC<ConnectionGuideProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] animate-fade-in">
      <div className="bg-dark-800 border border-dark-600 rounded-xl w-[520px] max-h-[80vh] overflow-hidden shadow-2xl animate-slide-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
          <h2 className="text-lg font-semibold text-dark-100">
            {t("guide.title")}
          </h2>
          <button
            onClick={onClose}
            className="text-dark-400 hover:text-dark-200 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto max-h-[calc(80vh-60px)]">
          <div className="space-y-5">
            {steps.map((step, index) => (
              <div key={index} className="flex gap-4">
                <div className="flex flex-col items-center">
                  {step.icon}
                  {index < steps.length - 1 && (
                    <div className="w-0.5 flex-1 bg-dark-700 mt-2" />
                  )}
                </div>
                <div className="flex-1 pb-4">
                  <h3 className="text-sm font-semibold text-dark-100 mb-1">
                    {t(step.titleKey)}
                  </h3>
                  <p className="text-sm text-dark-400 leading-relaxed">
                    {t(step.descKey)}
                  </p>
                </div>
              </div>
            ))}

            <div className="flex gap-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-green-400 mb-1">
                  {t("guide.completed")}
                </h3>
                <p className="text-sm text-dark-400 leading-relaxed">
                  {t("guide.completedDesc")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionGuide;
