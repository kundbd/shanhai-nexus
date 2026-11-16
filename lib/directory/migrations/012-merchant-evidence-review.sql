UPDATE import_items SET state='ready',message='暂缓审核：需按新版商业主体与同站交易线索规则复核。'
WHERE state IN ('ready','approved') AND id IN (SELECT item_id FROM merchant_candidates
  WHERE state='ready' AND json_extract(details,'$.version') IS NULL);
UPDATE merchant_candidates SET state='queued',reason='待按新版证据规则复核'
WHERE state='ready' AND json_extract(details,'$.version') IS NULL
  AND (item_id IS NULL OR item_id IN (SELECT id FROM import_items WHERE state='ready'));
