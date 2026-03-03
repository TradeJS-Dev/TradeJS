export const toJson = (data: any, stringify = false) => {
  return stringify ? JSON.stringify(data, null, 2) : JSON.stringify(data);
};
