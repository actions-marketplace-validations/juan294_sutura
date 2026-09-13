export const isoDate = (year, month, day) =>
  new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
