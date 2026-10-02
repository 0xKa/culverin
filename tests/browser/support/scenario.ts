export async function scenario<T>(
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  console.log("Browser scenario: " + name);
  try {
    return await run();
  } catch (cause) {
    throw new Error("Browser scenario failed: " + name, { cause });
  }
}
