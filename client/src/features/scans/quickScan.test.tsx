import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { quickScan } from './api';
import { QuickScanPage } from './pages';

vi.mock('./api', () => ({
  quickScan: vi.fn(),
  getScan: vi.fn(),
  getFindings: vi.fn(),
  getFileRisks: vi.fn(),
  getProjectScans: vi.fn(),
  getFileContent: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (v: string) => void;
  }) => (
    <textarea
      aria-label="Monaco Editor"
      data-testid="monaco-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

function renderQuickScan() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuickScanPage />
    </QueryClientProvider>
  );
}

describe('QuickScanPage Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading, description, language selector, and code editor', () => {
    renderQuickScan();
    expect(screen.getByRole('heading', { name: 'Quick scan' })).toBeInTheDocument();
    expect(screen.getByText(/Check a focused snippet of code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Language/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyze snippet' })).toBeInTheDocument();
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('allows switching programming language', () => {
    renderQuickScan();
    const select = screen.getByLabelText(/Language/i) as HTMLSelectElement;
    expect(select.value).toBe('typescript');

    fireEvent.change(select, { target: { value: 'python' } });
    expect(select.value).toBe('python');

    fireEvent.change(select, { target: { value: 'java' } });
    expect(select.value).toBe('java');

    fireEvent.change(select, { target: { value: 'javascript' } });
    expect(select.value).toBe('javascript');
  });

  it('updates snippet code and calls quickScan with selected language and code', async () => {
    vi.mocked(quickScan).mockResolvedValueOnce({
      findings: [],
      aiStatus: 'skipped',
      warnings: [],
    });

    renderQuickScan();
    const select = screen.getByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: 'python' } });

    const editor = screen.getByTestId('monaco-editor');
    fireEvent.change(editor, { target: { value: 'def add(a, b):\n    return a + b\n' } });

    const button = screen.getByRole('button', { name: 'Analyze snippet' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(quickScan).toHaveBeenCalledWith(
        'python',
        'def add(a, b):\n    return a + b\n'
      );
    });

    expect(await screen.findByText(/No findings in this snippet/i)).toBeInTheDocument();
  });

  it('displays defect findings with severity badges and AI suggestions when returned', async () => {
    vi.mocked(quickScan).mockResolvedValueOnce({
      findings: [
        {
          _id: 'f1',
          filePath: 'snippet.ts',
          line: 5,
          ruleId: 'security.hardcoded-secret',
          ruleIds: ['security.hardcoded-secret'],
          source: 'semgrep',
          severity: 'critical',
          category: 'security',
          message: 'Hardcoded API credential detected.',
          riskScore: 35,
          explanation: 'Storing secrets in code risks leaking credentials.',
          suggestion: 'Store credentials in environment variables.',
        },
      ],
      aiStatus: 'complete',
      warnings: ['High complexity detected in snippet'],
    });

    renderQuickScan();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze snippet' }));

    expect(await screen.findByText(/Results · AI complete/i)).toBeInTheDocument();
    expect(screen.getByText('Hardcoded API credential detected.')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByText('Storing secrets in code risks leaking credentials.')).toBeInTheDocument();
    expect(screen.getByText('Store credentials in environment variables.')).toBeInTheDocument();
    expect(screen.getByText('High complexity detected in snippet')).toBeInTheDocument();
  });
});
