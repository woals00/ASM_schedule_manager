// SOMA mentoring board enhancement (content script for mentoLec list pages).
// Thin shim: locate the SOMA calendar mount point, then mount <MentoLecPanel/>
// inside a Shadow DOM with feature CSS injected at the boundary.

import {
  MentoLecPanel,
  mentoLecPanelCss,
} from '@features/mentoring-board/MentoLecPanel';
import { mountReact } from '@shared/dom/react-mount';

if (location.href.includes('mentoLec')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

function init(): void {
  const calWrap = document.querySelector('.mypageCalendar.wrap');
  if (!calWrap) return;

  if (document.getElementById('asm-mentolec-react-host')) return;

  const host = document.createElement('div');
  host.id = 'asm-mentolec-react-host';

  const tabs = document.querySelector('.tabs-st1');
  if (tabs && tabs.parentNode) {
    tabs.parentNode.insertBefore(host, tabs.nextSibling);
  } else if (calWrap.parentNode) {
    calWrap.parentNode.insertBefore(host, calWrap);
  } else {
    return;
  }

  mountReact(host, <MentoLecPanel />, {
    styles: [mentoLecPanelCss],
    hostClass: 'asm-mentolec-host',
  });
}
