import { IconButton } from '@chakra-ui/react';
import { FaStar, FaRegStar } from 'react-icons/fa';
import { useFiltersContext } from '../context';
import { useTickers } from '@store';

export const FavoriteButton = () => {
  const {
    filters: { symbol },
  } = useFiltersContext();
  const { favorites, setFavorite } = useTickers();
  const isFavorite = favorites.includes(symbol);

  return (
    <IconButton
      size="xs"
      colorPalette="teal"
      variant={isFavorite ? 'solid' : 'outline'}
      onClick={() => setFavorite(symbol)}
    >
      {isFavorite ? <FaStar /> : <FaRegStar />}
    </IconButton>
  );
};
