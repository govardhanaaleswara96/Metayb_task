import axios from 'axios';
export const api = axios.create({ baseURL: '/api' });
export const actorHeaders = (id: string) => ({ headers: { 'x-user-id': id } });
export function apiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.error;
    if (detail?.code === 'INSUFFICIENT_STOCK') return `${detail.message}: ${detail.sku} has ${detail.availableQuantity} available.`;
    return detail?.message ?? (error.response ? 'Request failed. Please try again.' : 'Cannot reach the API. Check that the backend is running.');
  }
  return 'Something went wrong. Please try again.';
}
