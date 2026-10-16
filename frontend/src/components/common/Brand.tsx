import { AudioLines } from 'lucide-react';

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <AudioLines size={23} strokeWidth={2.3} />
      </span>
      SONORA<span className="brand-dot">®</span>
    </div>
  );
}
