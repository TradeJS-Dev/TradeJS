'use client';

import { Button, Field, Input, PinInput, Stack } from '@chakra-ui/react';
import { type Ref, useEffect, useRef, useState } from 'react';

type Props = {
  value?: string[];
  onChange?: (digits: string[]) => void;
  name?: string;
  submitterId?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  recovery?: {
    value: string | null;
    onChange: (value: string | null) => void;
  };
};

const label = 'Authenticator code';
const normalizePaste = (text: string) => text.replace(/[\s-]/g, '');
const translations = {
  inputLabel: (index: number) => `${label}, digit ${index + 1}`,
};

export const AuthenticatorCodeField = ({
  value,
  onChange,
  name,
  submitterId,
  required,
  disabled,
  autoFocus,
  inputRef,
  recovery,
}: Props) => {
  const hiddenInput = useRef<HTMLInputElement>(null);
  const lastSubmitted = useRef('');
  const [uncontrolledDigits, setUncontrolledDigits] = useState<string[]>([]);
  const digits = value ?? uncontrolledDigits;
  const code = digits.join('');
  const change = (next: string[]) => {
    if (value === undefined) setUncontrolledDigits(next);
    onChange?.(next);
  };
  const usingRecovery = recovery != null && recovery.value !== null;

  useEffect(() => {
    if (usingRecovery || !/^\d{6}$/.test(code)) {
      lastSubmitted.current = '';
      return;
    }
    const form = hiddenInput.current?.form;
    if (!form || disabled || lastSubmitted.current === code) return;

    const candidate = submitterId ? document.getElementById(submitterId) : null;
    const submitter =
      candidate instanceof HTMLButtonElement && candidate.form === form
        ? candidate
        : undefined;
    if (submitterId && !submitter) return;

    const markSubmitted = () => {
      lastSubmitted.current = code;
    };
    form.addEventListener('submit', markSubmitted);
    // The form handlers and its hidden field must both see the final digit.
    const frame = requestAnimationFrame(() => {
      if (lastSubmitted.current !== code && form.checkValidity()) {
        form.requestSubmit(submitter);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      form.removeEventListener('submit', markSubmitted);
    };
  }, [code, disabled, submitterId, usingRecovery]);

  return (
    <Stack gap={2} align="start">
      {usingRecovery ? (
        <Field.Root>
          <Field.Label>Recovery code</Field.Label>
          <Input
            ref={inputRef}
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={recovery.value ?? ''}
            onChange={(event) => recovery.onChange(event.target.value)}
            maxLength={64}
            disabled={disabled}
          />
        </Field.Root>
      ) : (
        <PinInput.Root
          value={digits}
          onValueChange={({ value: next }) => change(next)}
          onPasteCapture={(event) => {
            const pasted = normalizePaste(
              event.clipboardData.getData('text/plain'),
            );
            if (disabled || !/^\d{6}$/.test(pasted)) return;
            event.preventDefault();
            event.stopPropagation();
            change(pasted.split(''));
          }}
          count={6}
          type="numeric"
          otp
          placeholder=""
          autoFocus={autoFocus}
          selectOnFocus
          disabled={disabled}
          sanitizeValue={normalizePaste}
          translations={translations}
          w="full"
        >
          <PinInput.Label>{label}</PinInput.Label>
          <PinInput.HiddenInput ref={hiddenInput} />
          {name && <input type="hidden" name={name} value={code} />}
          <PinInput.Control
            role="group"
            aria-label={label}
            display="grid"
            gridTemplateColumns="repeat(6, minmax(0, 1fr))"
            w="full"
            maxW="17rem"
            gap={2}
          >
            {Array.from({ length: 6 }, (_, index) => (
              <PinInput.Input
                key={index}
                index={index}
                ref={index === 0 ? inputRef : undefined}
                autoComplete={index === 0 ? 'one-time-code' : 'off'}
                required={required}
                w="full"
                minW={0}
              />
            ))}
          </PinInput.Control>
        </PinInput.Root>
      )}
      {recovery && (
        <Button
          type="button"
          variant="plain"
          size="sm"
          px={0}
          disabled={disabled}
          onClick={() => {
            change([]);
            recovery.onChange(usingRecovery ? null : '');
          }}
        >
          {usingRecovery ? 'Use authenticator code' : 'Use recovery code'}
        </Button>
      )}
    </Stack>
  );
};
