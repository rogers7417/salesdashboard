interface Column {
  key: string;
  header: string;
  align?: 'left' | 'center' | 'right';
  render?: (value: any, row: any) => React.ReactNode;
  group?: string;
}

interface DataTableProps {
  columns: Column[];
  data: any[];
  loading?: boolean;
  className?: string;
}

export default function DataTable({ columns, data, loading, className }: DataTableProps) {
  if (loading) {
    return (
      <div>
        <div className="metro-loading" style={{ height: '40px', marginBottom: '8px' }}></div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="metro-loading" style={{ height: '32px', marginBottom: '4px' }}></div>
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
        데이터가 없습니다.
      </div>
    );
  }

  // 그룹 헤더 행 계산
  const hasGroups = columns.some(col => col.group);
  const groupRow: { label: string; colSpan: number; color?: string }[] = [];
  if (hasGroups) {
    let currentGroup = '';
    columns.forEach(col => {
      const g = col.group || '';
      if (g === currentGroup && groupRow.length > 0) {
        groupRow[groupRow.length - 1].colSpan++;
      } else {
        groupRow.push({ label: g, colSpan: 1 });
        currentGroup = g;
      }
    });
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className={`metro-table ${className || ''}`}>
        <thead>
          {hasGroups && (
            <tr>
              {groupRow.map((g, i) => (
                <th
                  key={i}
                  colSpan={g.colSpan}
                  style={{
                    textAlign: 'center',
                    fontSize: '0.72em',
                    fontWeight: 700,
                    color: g.label ? '#fff' : 'transparent',
                    background: g.label
                      ? g.label.includes('Lead') ? '#1565c0'
                        : g.label.includes('계약') ? '#2e7d32'
                        : '#555'
                      : 'transparent',
                    padding: g.label ? '3px 8px' : '0',
                    letterSpacing: '0.5px',
                    borderBottom: g.label ? 'none' : undefined,
                  }}
                >
                  {g.label || ''}
                </th>
              ))}
            </tr>
          )}
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ textAlign: col.align || 'left' }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr key={idx} style={row._isSummary ? {
              background: '#f5f7fa',
              borderTop: '2px solid #333',
              fontWeight: 700,
            } : undefined}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  style={{
                    textAlign: col.align || 'left',
                    ...(row._isSummary ? { fontWeight: 700, fontSize: '0.95em' } : {}),
                  }}
                >
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
