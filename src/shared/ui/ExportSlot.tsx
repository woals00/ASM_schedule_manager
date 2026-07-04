// Bridges to globalThis.ASMCalendarExport.appendExportButtons, which mutates
// its argument element directly. We hand it our ref'd div once on mount and
// keep a live ref to the latest event payload so the callback closure stays
// fresh across re-renders.
//
// Shared between mentoring registration history cards and content/
// (mentoLec event cards). Callers pass the className so each consumer keeps
// its own existing CSS hook.

import { useEffect, useRef } from 'react';

export interface ExportSlotProps {
  uid?: string;
  title: string;
  description: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  filenameBase: string;
  className: string;
}

export function ExportSlot({ className, ...props }: ExportSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const exporter = globalThis.ASMCalendarExport;
    if (!exporter) return;

    exporter.appendExportButtons(
      el,
      () => {
        const p = propsRef.current;
        if (!p.startsAt || !p.endsAt) return null;
        return {
          uid: p.uid,
          title: p.title,
          description: p.description,
          location: p.location,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
        };
      },
      props.filenameBase,
    );

    return () => {
      el.innerHTML = '';
    };
  }, [props.filenameBase]);

  return <div className={className} ref={ref} />;
}
