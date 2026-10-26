// Cloud Firestore adds a trailing __name__ tie-breaker when showing indexes.
// It is omitted from firebase.indexes.json; compare the declared fields only.
export function indexSignature(entry) {
  return [entry.collectionGroup,entry.queryScope,
    ...(entry.fields??[]).filter(field=>field.fieldPath!=='__name__')
      .map(field=>field.fieldPath+':'+(field.order??field.arrayConfig??''))].join('|');
}

export function missingRequiredIndexes(expected,deployed) {
  const found=new Set(deployed.map(indexSignature));
  return expected.filter(index=>!found.has(indexSignature(index)));
}
