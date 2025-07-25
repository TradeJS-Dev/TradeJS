'use client';

import { useState, useEffect } from 'react';
import {
  Button,
  CloseButton,
  Drawer,
  Portal,
  Icon,
  Textarea,
  Timeline,
  HStack,
  Text,
} from '@chakra-ui/react';
import { useRecoilValue } from 'recoil';
import { AIChatMessage, AIChatHistory } from '@types';
import { GiArtificialHive } from 'react-icons/gi';
import { filtersState } from '@atoms';
import { sendMessage, getHistory } from '@src/actions/ai';
import { Message } from './Message';

export const AiDrawer = () => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AIChatHistory>([]);
  const filters = useRecoilValue(filtersState);

  const loadHistory = async () => {
    setLoading(true);

    const history = await getHistory(filters.symbol);

    setMessages(history);

    setLoading(false);
  };

  useEffect(() => {
    loadHistory();
  }, [filters.symbol]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const message = {
      from: 'user',
      text: input,
      command: 'prompt',
    } as AIChatMessage;

    setMessages((state) => [...state, message]);

    const response = await sendMessage({ message, filters });

    setMessages((state) => [...state, response]);

    setInput('');
  };

  const handleQuick = async (command: string) => {
    let message: AIChatMessage | null = null;

    if (command === '/line') {
      message = {
        from: 'user',
        text: 'Какие наклонные линии можно построить на данном графике',
        command,
      };
    }

    if (!message) {
      return;
    }

    setMessages((state) => [...state, message]);

    const response = await sendMessage({ message, filters });

    setMessages((state) => [...state, response]);

    console.log('>>> res', response.text);
  };

  return (
    <Drawer.Root open={open} onOpenChange={(e) => setOpen(e.open)} size={'lg'}>
      <Drawer.Trigger asChild>
        <Button size="sm" variant="outline">
          <Icon as={GiArtificialHive} boxSize={6} color="teal.500" />
          <Text color="teal.500">AI</Text>
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
              <Timeline.Root>
                {messages.map((message, index) => (
                  <Message key={index} message={message} index={index} />
                ))}
              </Timeline.Root>
            </Drawer.Body>

            <Drawer.Footer flexDirection="column" alignItems="stretch" gap={3}>
              <HStack>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleQuick('/line')}
                >
                  /line
                </Button>
                <Button
                  size="sm"
                  variant="outline"
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
                onChange={(e) => setInput(e.target.value)}
              />

              <Button
                colorScheme="teal"
                mt={2}
                size={'sm'}
                variant="subtle"
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
