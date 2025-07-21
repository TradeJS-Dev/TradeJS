'use client';

import {
  Button,
  CloseButton,
  Drawer,
  Portal,
  Icon,
  Textarea,
  Timeline,
  HStack,
  Box,
  Text,
} from '@chakra-ui/react';
import { GiArtificialHive } from 'react-icons/gi';
import { PiRobotFill, PiUserFill } from 'react-icons/pi';
import { useState } from 'react';

export const AiDrawer = () => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<
    { from: 'user' | 'ai'; text: string }[]
  >([]);

  const handleSend = () => {
    if (!input.trim()) return;

    setMessages((prev) => [
      ...prev,
      { from: 'user', text: input },
      { from: 'ai', text: `AI ответ на: ${input}` },
    ]);
    setInput('');
  };

  const handleQuick = (cmd: string) => {
    setInput(cmd);
  };

  return (
    <Drawer.Root open={open} onOpenChange={(e) => setOpen(e.open)} size={'lg'}>
      <Drawer.Trigger asChild>
        <Button size="sm" variant="outline">
          <Icon as={GiArtificialHive} boxSize={6} color="teal.500" />
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
                {messages.map((msg, idx) => (
                  <Timeline.Item key={idx}>
                    <Timeline.Connector>
                      <Timeline.Separator />
                      <Timeline.Indicator>
                        {msg.from === 'user' ? <PiUserFill /> : <PiRobotFill />}
                      </Timeline.Indicator>
                    </Timeline.Connector>

                    <Timeline.Content>
                      <Timeline.Title fontSize="sm" fontWeight="bold">
                        {msg.from === 'user' ? 'Пользователь' : 'AI'}
                      </Timeline.Title>
                      <Timeline.Description fontSize="xs" color="gray.500">
                        {/* В будущем сюда можно вставить timestamp */}
                        Сообщение #{idx + 1}
                      </Timeline.Description>
                      <Box
                        mt={1}
                        py={2}
                        borderRadius="lg"
                        w="fit-content"
                        maxW="full"
                      >
                        <Text fontSize="sm">{msg.text}</Text>
                      </Box>
                    </Timeline.Content>
                  </Timeline.Item>
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
                onClick={handleSend}
              >
                Отправить
              </Button>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
};
