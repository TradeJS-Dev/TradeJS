import { FavoriteButton } from '#shared/FavoriteButton';
import { useFavoriteTests } from '#store';
import { useTestContext } from '../context';

export const TestCardFavoriteIndicator = () => {
  const { testResult } = useTestContext();
  const { checkIsFavorite, toggleFavorite } = useFavoriteTests();
  const isFavorite = checkIsFavorite(testResult.test.name);

  return (
    <FavoriteButton
      isFavorite={isFavorite}
      onChangeFavorite={() =>
        toggleFavorite(testResult.test.name, testResult.stat.netProfit)
      }
    />
  );
};
