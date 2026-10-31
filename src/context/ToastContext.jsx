import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const show = useCallback((message, type = 'default') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] rounded-md px-5 py-2.5 text-[13px] text-white shadow-lift ${
            toast.type === 'error' ? 'bg-danger' : toast.type === 'success' ? 'bg-ok' : 'bg-navy'
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}
