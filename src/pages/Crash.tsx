import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { Shell } from '@/components/Shell';

/** Each button triggers a render-time throw (state change → re-render →
 * throw), which is what ErrorBoundary catches — click-handler throws go
 * to window.onerror and bypass React. */
const Throwers = () => {
  const [errorFactory, setErrorFactory] = useState<null | (() => Error)>(null);

  const buttons: [string, () => Error][] = [
    ['plain error', () => new Error('Something exploded in a completely ordinary way.')],
    ['typeerror', () => {
      const o: unknown = null;
      void o;
      return new TypeError("Cannot read properties of null (reading 'foo')");
    }],
    ['network', () => new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:443')],
    ['json parse', () => {
      try {
        JSON.parse('{"kind":');
      } catch (e) {
        return e as Error;
      }
      return new Error('unreachable');
    }],
    ['long message', () => new Error(
      'A very long error message to test wrapping and layout when the error text goes on and on and does not stop because some errors are just like that, they contain entire stack contexts embedded in the message itself.',
    )],
    ['empty', () => new Error('')],
  ];

  if (errorFactory) throw errorFactory();

  return (
    <div className="space-y-3">
      {buttons.map(([label, fn]) => (
        <button
          key={label}
          type="button"
          onClick={() => setErrorFactory(fn)}
          className="w-full rounded-sm border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          throw: {label}
        </button>
      ))}
    </div>
  );
};

const CrashPage = () => {
  useSeoMeta({ title: 'crash test — nostr.black' });

  return (
    <Shell>
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          each button throws during render — the black screen of death should catch it
        </p>
        <Throwers />
      </div>
    </Shell>
  );
};

export default CrashPage;
