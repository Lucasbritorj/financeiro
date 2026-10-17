/** Não presume que o limite do servidor é igual ao tamanho pedido. */
export async function lerTodasPaginas<T extends { id: string }>(
  buscar: (depois: string | null, tamanho: number) => PromiseLike<{
    data: T[] | null; error: { message: string } | null;
  }>,
): Promise<T[]> {
  const linhas: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const { data, error } = await buscar(cursor, 500);
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Consulta sem resposta. Tente novamente.");
    if (data.length === 0) return linhas;
    const proximo = data[data.length - 1].id;
    if (!proximo || (cursor !== null && proximo <= cursor)) throw new Error("A consulta não avançou. Tente novamente.");
    linhas.push(...data);
    cursor = proximo;
    if (linhas.length > 100_000) {
      throw new Error("Há mais de 100 mil lançamentos. Selecione um período menor.");
    }
  }
}
