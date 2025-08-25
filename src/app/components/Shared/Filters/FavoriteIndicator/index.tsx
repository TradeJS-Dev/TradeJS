import { useFiltersContext } from '../context';
import { FavoriteButton } from '@shared/FavoriteButton';
import { useTickers } from '@store';

export const FavoriteIndicator = () => {
  const {
    filters: { symbol },
  } = useFiltersContext();
  const { checkIsFavorite, setFavorite } = useTickers();
  const isFavorite = checkIsFavorite(symbol);

  return (
    <FavoriteButton
      isFavorite={isFavorite}
      onChangeFavorite={() => setFavorite(symbol)}
    />
  );
};
