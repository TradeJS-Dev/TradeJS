import react from 'react';
import { Timeline, Box, Text } from '@chakra-ui/react';
import { PiRobotFill, PiUserFill } from 'react-icons/pi';
import { AIChatMessage } from '@tradejs/types';

interface MessageProps {
  message: AIChatMessage;
  index: number;
}

export const Message = ({ message, index }: MessageProps) => {
  return (
    <Timeline.Item key={index}>
      <Timeline.Connector>
        <Timeline.Separator />
        <Timeline.Indicator>
          {message.from === 'user' ? <PiUserFill /> : <PiRobotFill />}
        </Timeline.Indicator>
      </Timeline.Connector>

      <Timeline.Content>
        <Timeline.Title fontSize="sm" fontWeight="bold">
          {message.from === 'user' ? 'User' : 'AI'}
        </Timeline.Title>
        <Timeline.Description fontSize="xs" color="gray.500">
          {/* В будущем сюда можно вставить timestamp */}
          Message #{index + 1}
        </Timeline.Description>
        <Box mt={1} py={2} borderRadius="lg" w="fit-content" maxW="full">
          <Text fontSize="sm">{message.text}</Text>
        </Box>
      </Timeline.Content>
    </Timeline.Item>
  );
};
