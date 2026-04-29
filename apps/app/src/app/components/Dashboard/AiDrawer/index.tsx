'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  CloseButton,
  Drawer,
  Portal,
  Icon,
  Textarea,
  Timeline,
  HStack,
  Stack,
  Text,
  Alert,
  SkeletonCircle,
  SkeletonText,
} from '@chakra-ui/react';
import { GiArtificialHive } from 'react-icons/gi';
import { useAiChatStore, useFilters } from '@store';
import { Message } from './Message';

export const AiDrawer = () => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const { filters } = useFilters();
  const getChat = useAiChatStore((s) => s.getChat);
  const loadHistory = useAiChatStore((s) => s.loadHistory);
  const sendPrompt = useAiChatStore((s) => s.sendPrompt);
  const sendQuickCommand = useAiChatStore((s) => s.sendQuickCommand);
  const chat = getChat(filters.symbol);
  const { loading, sending, error, messages } = chat;
  const isBusy = loading || sending;
  const canSend = useMemo(
    () => input.trim().length > 0 && !sending,
    [input, sending],
  );

  useEffect(() => {
    void loadHistory(filters.symbol);
  }, [filters.symbol, loadHistory]);

  const handleSend = async () => {
    if (!input.trim()) return;
    await sendPrompt(filters, input);
    setInput('');
  };

  const handleQuick = async (command: string) => {
    await sendQuickCommand(filters, command);
  };

  return (
    <Drawer.Root open={open} onOpenChange={(e) => setOpen(e.open)} size={'lg'}>
      <Drawer.Trigger asChild>
        <Button
          colorPalette="teal"
          size="sm"
          variant={open ? 'surface' : 'outline'}
        >
          <Icon as={GiArtificialHive} boxSize={6} />
          <Text>AI</Text>
        </Button>
      </Drawer.Trigger>
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content display="flex" flexDirection="column">
            <Drawer.Header>
              <Drawer.Title>AI assistant</Drawer.Title>
              <Drawer.CloseTrigger asChild>
                <CloseButton position="absolute" right="3" top="3" />
              </Drawer.CloseTrigger>
            </Drawer.Header>

            <Drawer.Body overflowY="auto" flex="1">
              {error ? (
                <Alert.Root status="error" mb={4}>
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>AI chat error</Alert.Title>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              ) : null}
              {loading ? (
                <Stack gap="4" maxW="xs">
                  <HStack width="full">
                    <SkeletonCircle size="6" />
                    <SkeletonText noOfLines={2} />
                  </HStack>
                  <SkeletonText ml="8" noOfLines={3} />
                </Stack>
              ) : (
                <Timeline.Root>
                  {messages.map((message, index) => (
                    <Message key={index} message={message} index={index} />
                  ))}
                </Timeline.Root>
              )}
            </Drawer.Body>

            <Drawer.Footer flexDirection="column" alignItems="stretch" gap={3}>
              <HStack>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => handleQuick('/line')}
                >
                  /line
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => handleQuick('/analyze')}
                >
                  /analyze
                </Button>
              </HStack>

              <Textarea
                size="sm"
                placeholder="Введите сообщение..."
                autoresize
                rows={3}
                maxH="15lh"
                value={input}
                disabled={sending}
                onChange={(e) => setInput(e.target.value)}
              />

              <Button
                mt={2}
                size={'sm'}
                variant="subtle"
                disabled={!canSend}
                loading={sending}
                onClick={handleSend}
              >
                Send
              </Button>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
};
