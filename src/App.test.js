import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

test('renders landing page hero', () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
  const heading = screen.getByText(/all-in-one hardware/i);
  expect(heading).toBeInTheDocument();
});