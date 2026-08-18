import React, { createContext, useContext } from 'react';
import { useCustomExercises } from '@/hooks/useCustomExercises';
import type { CustomExercise } from '@/hooks/useCustomExercises';
import type { CustomExerciseInput } from '@/hooks/useCustomExercises';

interface CustomExercisesContextValue {
  exercises: CustomExercise[];
  loading: boolean;
  addExercise: (input: CustomExerciseInput) => Promise<void>;
  deleteExercise: (id: string) => Promise<void>;
  updateExercise: (id: string, input: CustomExerciseInput) => Promise<void>;
}

const CustomExercisesContext = createContext<CustomExercisesContextValue>({
  exercises: [],
  loading: true,
  addExercise: async () => {},
  deleteExercise: async () => {},
  updateExercise: async () => {},
});

export const useCustomExercisesContext = () => useContext(CustomExercisesContext);

export const CustomExercisesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const hook = useCustomExercises();
  return (
    <CustomExercisesContext.Provider value={hook}>
      {children}
    </CustomExercisesContext.Provider>
  );
};
