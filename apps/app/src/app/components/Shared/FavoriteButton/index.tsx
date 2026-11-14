import { IconButton } from '@chakra-ui/react';
import { FaStar, FaRegStar } from 'react-icons/fa';

interface FavoriteButtonProps {
  isFavorite: boolean;
  onChangeFavorite: () => void;
}

export const FavoriteButton = ({
  isFavorite,
  onChangeFavorite,
}: FavoriteButtonProps) => {
  return (
    <IconButton
      size="xs"
      colorPalette="teal"
      variant={isFavorite ? 'subtle' : 'ghost'}
      aria-label="Favorite symbol"
      aria-pressed={isFavorite}
      title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      onClick={() => onChangeFavorite()}
    >
      {isFavorite ? <FaStar /> : <FaRegStar />}
    </IconButton>
  );
};
