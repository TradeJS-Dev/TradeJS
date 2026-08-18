import fs from 'node:fs';
import path from 'node:path';

describe('quickstart e2e cleanup', () => {
  it('waits for the full process tree and retries temporary-directory removal', () => {
    const script = fs.readFileSync(
      path.resolve(__dirname, '../quickstart-e2e.sh'),
      'utf8',
    );

    expect(script).toContain('kill -KILL "$parent_pid"');
    expect(script).toContain('for attempt in $(seq 1 50)');
    expect(script).toContain('remove_tree "$PROJECT_DIR"');
    expect(script).toContain('for attempt in $(seq 1 10)');
  });
});
