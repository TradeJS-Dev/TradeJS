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

  const data = await handleResponse<T>(response);

  return data;
};

const post = async <T>(url: string, body: object): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await handleResponse<T>(response);

  return data;
};

const remove = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    method: 'DELETE',
  });

  const data = await handleResponse<T>(response);

  return data;
};

export const API = {
  get,
  post,
  delete: remove,
};
