import { useFiltersContext } from '../context';
import { FavoriteButton } from '@shared/FavoriteButton';
import { useTickers } from '@store';

export const FavoriteIndicator = () => {
  const {
    filters: { symbol },
  } = useFiltersContext();
  const { checkIsFavorite, toggleFavorite } = useTickers();
  const isFavorite = checkIsFavorite(symbol);

  return (
    <FavoriteButton
      isFavorite={isFavorite}
      onChangeFavorite={() => toggleFavorite(symbol)}
    />
  );
};
