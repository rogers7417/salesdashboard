import { useState, useEffect } from 'react';
import { fetchKPIReport, fetchKPIMonths } from './api';

function getPrevMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const prevDate = new Date(year, mon - 2, 1); // mon-1 is current (0-indexed), mon-2 is previous
  return `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
}

export interface UseReportDataResult {
  data: any;
  prevData: any;
  loading: boolean;
  error: string | null;
  months: string[];
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
}

export function useReportData(initialMonth?: string): UseReportDataResult {
  const [selectedMonth, setSelectedMonth] = useState<string>(initialMonth || '');
  const [months, setMonths] = useState<string[]>([]);
  const [data, setData] = useState<any>(null);
  const [prevData, setPrevData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load available months
  useEffect(() => {
    fetchKPIMonths()
      .then((res) => {
        const m = res?.months || [];
        setMonths(m);
        if (!initialMonth && m.length > 0) {
          setSelectedMonth(m[0]);
        }
      })
      .catch(() => setError('Failed to load available months.'));
  }, [initialMonth]);

  // Load current and previous month data
  useEffect(() => {
    if (!selectedMonth) return;

    setLoading(true);
    setError(null);

    const prevMonth = getPrevMonth(selectedMonth);

    Promise.all([
      fetchKPIReport(selectedMonth),
      fetchKPIReport(prevMonth).catch(() => null),
    ])
      .then(([current, previous]) => {
        setData(current);
        setPrevData(previous);
      })
      .catch(() => setError('Failed to load report data.'))
      .finally(() => setLoading(false));
  }, [selectedMonth]);

  return {
    data,
    prevData,
    loading,
    error,
    months,
    selectedMonth,
    setSelectedMonth,
  };
}

export default useReportData;
