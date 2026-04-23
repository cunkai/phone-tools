import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface CoordInputProps {
  value: any;
  onChange: (value: any) => void;
  onCoordInput?: (coord: any) => void;
  label?: string;
}

export const CoordInput: React.FC<CoordInputProps> = ({ value, onChange, onCoordInput, label }) => {
  const { t } = useTranslation();
  const [coordType, setCoordType] = useState<'fixed' | 'random_rect' | 'random_circle' | 'custom'>(value?.type || 'fixed');

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const type = e.target.value as 'fixed' | 'random_rect' | 'random_circle' | 'custom';
    setCoordType(type);
    const newVal = {
      ...value,
      type,
      ...(type !== 'random_rect' && { rectParams: undefined }),
      ...(type !== 'random_circle' && { circleParams: undefined }),
      ...(type !== 'custom' && { customCode: undefined }),
    };
    onChange(newVal);

    if (!onCoordInput) return;
    onCoordInput(newVal);
  };

  // 确保固定坐标也有type属性
  useEffect(() => {
    if (!value.type) {
      const newVal = {
        ...value,
        type: 'fixed'
      };
      onChange(newVal);
    }
  }, [value, onChange]);

  const handleCoordChange = (key: 'x' | 'y', val: string) => {
    // 对于小数，不做前导零处理，保留用户输入的格式
    let processedValue = val;
    if (val !== '') {
      // 只有当输入不是以0开头且后面跟着小数点时，才去除前导零
      if (!val.startsWith('0.') && val.includes('.') === false) {
        processedValue = val.replace(/^0+(?!$)/, '');
      }
    }
    
    const newVal = {
      ...value,
      type: value.type || 'fixed',
      [key]: processedValue,
    };
    onChange(newVal);

    if (!onCoordInput) return;
    onCoordInput(newVal);
  };

  const handleRectParamChange = (key: 'width' | 'height', val: string) => {
    const newVal = {
      ...value,
      rectParams: {
        ...value.rectParams,
        [key]: val !== '' ? Number(val) : '',
      },
    };
    onChange(newVal);

    if (!onCoordInput) return;
    onCoordInput(newVal);
  };

  const handleCircleParamChange = (key: 'radius', val: string) => {
    const newVal = {
      ...value,
      circleParams: {
        ...value.circleParams,
        [key]: val !== '' ? Number(val) : '',
      },
    };
    onChange(newVal);

    if (!onCoordInput) return;
    onCoordInput(newVal);
  };

  const handleCustomCodeChange = (val: string) => {
    const newVal = {
      ...value,
      customCode: val,
    };
    onChange(newVal);

    if (!onCoordInput) return;
    onCoordInput(newVal);
  };

  const inputCls = "w-full px-2.5 py-1.5 rounded-md bg-dark-700 border border-dark-600 text-dark-200 text-xs focus:outline-none focus:border-accent-500/50 transition-colors";
  const labelCls = "text-xs text-dark-400 mb-1 block";
  const selectCls = "px-2 py-1.5 rounded-md bg-dark-700 border border-dark-600 text-dark-200 text-xs focus:outline-none focus:border-accent-500/50 transition-colors";
  const cardCls = "p-3 rounded-lg border border-dark-700 bg-dark-800/50";

  return (
    <div className={cardCls}>
      {/* 标题和类型选择 */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-dark-200">{label}</div>
        <select
          value={coordType}
          onChange={handleTypeChange}
          className={selectCls}
        >
          <option value="fixed">固定</option>
          <option value="random_rect">矩形随机</option>
          <option value="random_circle">圆形随机</option>
          <option value="custom">自定义</option>
        </select>
      </div>

      {/* 固定坐标 */}
      {coordType === 'fixed' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>X</label>
            <input
              type="text"
              inputMode="numeric"
              value={value?.x || ''}
              onChange={(e) => handleCoordChange('x', e.target.value)}
              className={inputCls}
              placeholder="x"
            />
          </div>
          <div>
            <label className={labelCls}>Y</label>
            <input
              type="text"
              inputMode="numeric"
              value={value?.y || ''}
              onChange={(e) => handleCoordChange('y', e.target.value)}
              className={inputCls}
              placeholder="y"
            />
          </div>
        </div>
      )}

      {/* 矩形随机 */}
      {coordType === 'random_rect' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>X (左上角)</label>
              <input
                type="text"
                inputMode="numeric"
                value={value?.x || ''}
                onChange={(e) => handleCoordChange('x', e.target.value)}
                className={inputCls}
                placeholder="x"
              />
            </div>
            <div>
              <label className={labelCls}>Y (左上角)</label>
              <input
                type="text"
                inputMode="numeric"
                value={value?.y || ''}
                onChange={(e) => handleCoordChange('y', e.target.value)}
                className={inputCls}
                placeholder="y"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>宽度</label>
              <input
                type="number"
                value={value?.rectParams?.width || ''}
                onChange={(e) => handleRectParamChange('width', e.target.value)}
                className={inputCls}
                placeholder="宽度"
                min={1}
              />
            </div>
            <div>
              <label className={labelCls}>高度</label>
              <input
                type="number"
                value={value?.rectParams?.height || ''}
                onChange={(e) => handleRectParamChange('height', e.target.value)}
                className={inputCls}
                placeholder="高度"
                min={1}
              />
            </div>
          </div>
        </div>
      )}

      {/* 圆形随机 */}
      {coordType === 'random_circle' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>X (圆心)</label>
              <input
                type="text"
                inputMode="numeric"
                value={value?.x || ''}
                onChange={(e) => handleCoordChange('x', e.target.value)}
                className={inputCls}
                placeholder="x"
              />
            </div>
            <div>
              <label className={labelCls}>Y (圆心)</label>
              <input
                type="text"
                inputMode="numeric"
                value={value?.y || ''}
                onChange={(e) => handleCoordChange('y', e.target.value)}
                className={inputCls}
                placeholder="y"
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>半径</label>
            <input
              type="number"
              value={value?.circleParams?.radius || ''}
              onChange={(e) => handleCircleParamChange('radius', e.target.value)}
              className={inputCls}
              placeholder="半径"
              min={1}
            />
          </div>
        </div>
      )}

      {/* 自定义随机 */}
      {coordType === 'custom' && (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>自定义随机代码</label>
            <textarea
              value={value?.customCode || ''}
              onChange={(e) => handleCustomCodeChange(e.target.value)}
              className={`${inputCls} resize-none h-24 font-mono`}
              placeholder="// 返回 { x: number, y: number }\nreturn {\n  x: Math.floor(Math.random() * 1080),\n  y: Math.floor(Math.random() * 2400)\n};"
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );
};