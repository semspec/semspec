// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// A hook that is true while the viewport uses the phone layout.
import { useEffect, useState } from 'react';
import { PHONE_QUERY } from '@/lib/breakpoint';

export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}
