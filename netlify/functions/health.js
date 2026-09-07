export default async () =>
  Response.json({ status: 'ok', addon: 'Waddon Hi-Fi', time: new Date().toISOString() });
