import { useEffect, useRef } from 'react';

interface UseBackButtonOptions {
  onBack: (isDoubleTap: boolean) => void;
}

export function useBackButton({ onBack }: UseBackButtonOptions) {
  const lastPressTime = useRef<number>(0);

  useEffect(() => {
    // ۱. تزریق State اولیه به تاریخچه برای جلوگیری از خروج آنی مرورگر
    window.history.pushState({ pageGuard: true }, '', window.location.href);

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      const now = Date.now();
      const timeDiff = now - lastPressTime.current;
      const isDoubleTap = timeDiff < 2000;

      if (!isDoubleTap) {
        lastPressTime.current = now;
        // هیستوری را مجدداً قفل نگه می‌داریم تا ضربه دوم گرفته شود
        window.history.pushState({ pageGuard: true }, '', window.location.href);
      }

      onBack(isDoubleTap);
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [onBack]);
}
