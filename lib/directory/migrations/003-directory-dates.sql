-- Convert legacy date-only creation and update values from the editorial timezone to UTC.
UPDATE sites
SET added_at=strftime('%Y-%m-%dT%H:%M:%fZ',added_at,'-8 hours')
WHERE length(added_at)=10 AND date(added_at)=added_at;
UPDATE sites
SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ',updated_at,'-8 hours')
WHERE length(updated_at)=10 AND date(updated_at)=updated_at;
