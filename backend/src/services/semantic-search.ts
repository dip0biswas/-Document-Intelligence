type EmbeddedDocument = {
  embedding?: number[] | null;
};

export type RankedDocument<T> = T & { score: number };

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number | undefined {
  if (left.length === 0 || left.length !== right.length) return undefined;
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined || rightValue === undefined ||
        !Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return undefined;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return undefined;
  return dotProduct / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function rankByCosine<T extends EmbeddedDocument>(
  documents: T[],
  queryEmbedding: readonly number[],
  page: number,
  limit: number
): { documents: Array<RankedDocument<T>>; total: number; pages: number } {
  const ranked = documents.flatMap((document) => {
    if (!document.embedding) return [];
    const score = cosineSimilarity(document.embedding, queryEmbedding);
    return score === undefined ? [] : [{ ...document, score: Number(score.toFixed(6)) }];
  });
  ranked.sort((left, right) => right.score - left.score);
  const offset = (page - 1) * limit;
  return {
    documents: ranked.slice(offset, offset + limit),
    total: ranked.length,
    pages: Math.ceil(ranked.length / limit)
  };
}
