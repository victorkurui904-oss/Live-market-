import React from 'react';
import { formatPercent } from './market-data';

type TSplitBarProps = { left_label: string; left: number; right_label: string; right: number };

const SplitBar = ({ left_label, left, right_label, right }: TSplitBarProps) => {
    const total = left + right || 1;
    const left_width = (left / total) * 100;

    return (
        <div className='trading-tools__split'>
            <div className='trading-tools__split-labels'>
                <span>
                    {left_label} <strong>{formatPercent(left)}</strong>
                </span>
                <span>
                    {right_label} <strong>{formatPercent(right)}</strong>
                </span>
            </div>
            <div
                className='trading-tools__split-bar'
                role='img'
                aria-label={`${left_label} ${formatPercent(left)}, ${right_label} ${formatPercent(right)}`}
            >
                <span className='trading-tools__split-left' style={{ width: `${left_width}%` }} />
                <span className='trading-tools__split-right' style={{ width: `${100 - left_width}%` }} />
            </div>
        </div>
    );
};

export default SplitBar;
