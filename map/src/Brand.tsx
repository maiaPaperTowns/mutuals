import { useContext } from 'react';
import { StyleContext } from './style';

export default function Brand() {
  const { style } = useContext(StyleContext);
  return <a className="brand" href="/" aria-label="mutuals">{style === 'formal' ? <b className="brand-text">mutuals</b> : <img className="brand-word" src="/mutuals/mutuals_word.png" alt="mutuals" />}<small>PEOPLE FIND PEOPLE · MHACKS 2026</small></a>;
}
