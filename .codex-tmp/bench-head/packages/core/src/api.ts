const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'API request failed');
  }

  return response.json();
};

const get = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
  });

  return handleResponse<T>(response);
};

const post = async <T>(url: string, body: object): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return handleResponse<T>(response);
};

const remove = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    method: 'DELETE',
  });

  return handleResponse<T>(response);
};

export const API = {
  get,
  post,
  delete: remove,
};
