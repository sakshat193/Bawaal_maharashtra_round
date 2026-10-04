export function createEntryResponse(template, request) {
  return {
    ...template,
    receipt: {
      ...template.receipt,
      tier_id: request.tier_id,
      quantity: request.quantity
    }
  };
}

export function applyCreatedReceipt(me, receipt) {
  if (me?.entry?.status !== 'registered' || !receipt) return me;
  return {
    ...me,
    entry: {
      ...me.entry,
      tier_id: receipt.tier_id,
      quantity: receipt.quantity
    }
  };
}
