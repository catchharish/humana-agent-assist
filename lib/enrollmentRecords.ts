const g = globalThis as unknown as {
  __haaEnrollments?: Map<string, Record<string, unknown>>;
};
g.__haaEnrollments ??= new Map();

export function saveEnrollment(id: string, record: Record<string, unknown>) {
  g.__haaEnrollments!.set(id, record);
}

export function getEnrollment(id: string) {
  return g.__haaEnrollments!.get(id);
}
