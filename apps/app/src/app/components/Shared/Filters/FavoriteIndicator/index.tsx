import { useFiltersContext } from '../context';
import { FavoriteButton } from '#shared/FavoriteButton';
import { useTickers } from '#store';

export const FavoriteIndicator = () => {
  const {
    filters: { symbol, provider },
  } = useFiltersContext();
  const { checkIsFavorite, toggleFavorite } = useTickers(provider || 'bybit', {
    enabled: false,
  });
  const isFavorite = checkIsFavorite(symbol);

  return (
    <FavoriteButton
      isFavorite={isFavorite}
      onChangeFavorite={() => toggleFavorite(symbol)}
    />
  );
};
