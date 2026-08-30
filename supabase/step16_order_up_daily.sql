-- BrainiLab Backend — Step 16: Order Up Daily
-- Run after Step 15.
--
-- Replaces Flag Dash in the CURRENT four-game Daily lineup:
--   Brain Mix + Order Up + Topic Rush + BrainiWord
--
-- Order Up:
-- - 2 rounds per Daily
-- - exactly 10 items per round
-- - initial public payload never exposes the correct order
-- - each round has 45 item pairs
-- - round score = correct ordered pairs / 45 * 1,250
-- - Daily maximum = 2,500
--
-- Historical Flag Dash rows/results remain intact and verifiable.
-- From Order Up launch_date onward, Flag Dash no longer contributes to
-- Daily Brain Score / Full Daily completion.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- ORDER UP CONTENT
-- ============================================================

create table if not exists public.order_up_settings(
  singleton boolean primary key default true,
  launch_date date not null default ((now() at time zone 'UTC')::date),
  cooldown_days integer not null default 14,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_up_singleton check(singleton=true),
  constraint order_up_cooldown_range check(cooldown_days between 0 and 60)
);

insert into public.order_up_settings(
  singleton,launch_date,cooldown_days
)
values(true,(now() at time zone 'UTC')::date,14)
on conflict(singleton)
do update set
  launch_date=least(order_up_settings.launch_date,excluded.launch_date),
  updated_at=now();


create table if not exists public.order_up_rounds(
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  title text not null,
  prompt text not null,
  direction_label text not null,
  category text not null default 'general',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint order_up_external_key_length
    check(char_length(external_key) between 3 and 120),

  constraint order_up_title_length
    check(char_length(title) between 3 and 140),

  constraint order_up_prompt_length
    check(char_length(prompt) between 3 and 300),

  constraint order_up_direction_length
    check(char_length(direction_label) between 3 and 80),

  constraint order_up_category_length
    check(char_length(category) between 2 and 40)
);


create table if not exists public.order_up_items(
  id uuid primary key default gen_random_uuid(),

  round_id uuid not null
    references public.order_up_rounds(id)
    on delete cascade,

  sort_position integer not null,
  label text not null,

  created_at timestamptz not null default now(),

  unique(round_id,sort_position),
  unique(round_id,label),

  constraint order_up_position_range
    check(sort_position between 1 and 10),

  constraint order_up_item_label_length
    check(char_length(label) between 1 and 180)
);


create table if not exists public.daily_order_up_rounds(
  daily_challenge_id uuid not null
    references public.daily_challenges(id)
    on delete cascade,

  position integer not null,

  round_id uuid not null
    references public.order_up_rounds(id)
    on delete restrict,

  created_at timestamptz not null default now(),

  primary key(daily_challenge_id,position),
  unique(daily_challenge_id,round_id),

  constraint daily_order_up_position_range
    check(position between 1 and 2)
);

create index if not exists daily_order_up_round_idx
  on public.daily_order_up_rounds(round_id);

create index if not exists order_up_items_round_idx
  on public.order_up_items(round_id,sort_position);


-- Migration-only seed helper. It is dropped after seeds are loaded.
create or replace function public._seed_brainilab_order_up(
  p_external_key text,
  p_title text,
  p_prompt text,
  p_direction_label text,
  p_category text,
  p_items text[]
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_round_id uuid;
  v_item text;
  v_position integer:=0;
begin
  if coalesce(array_length(p_items,1),0)<>10 then
    raise exception 'Order Up seed requires exactly 10 items';
  end if;

  if (
    select count(distinct lower(btrim(x)))
    from unnest(p_items) x
  )<>10 then
    raise exception 'Order Up seed items must be unique';
  end if;

  insert into public.order_up_rounds(
    external_key,
    title,
    prompt,
    direction_label,
    category,
    is_active
  )
  values(
    lower(btrim(p_external_key)),
    btrim(p_title),
    btrim(p_prompt),
    btrim(p_direction_label),
    lower(btrim(p_category)),
    true
  )
  on conflict(external_key)
  do update set
    title=excluded.title,
    prompt=excluded.prompt,
    direction_label=excluded.direction_label,
    category=excluded.category,
    is_active=true,
    updated_at=now()
  returning id into v_round_id;

  -- Idempotency / historical safety:
  -- once a round has been assigned to any Daily, re-running this migration
  -- may update metadata but must never rewrite its canonical item order.
  if exists(
    select 1
    from public.daily_order_up_rounds dour
    where dour.round_id=v_round_id
  ) then
    return v_round_id;
  end if;

  delete from public.order_up_items
  where round_id=v_round_id;

  foreach v_item in array p_items
  loop
    v_position:=v_position+1;

    insert into public.order_up_items(
      round_id,
      sort_position,
      label
    )
    values(
      v_round_id,
      v_position,
      btrim(v_item)
    );
  end loop;

  return v_round_id;
end;
$$;

select public._seed_brainilab_order_up('first-us-presidents','First U.S. presidents','Put these U.S. presidents in order of taking office.','Earliest → Latest','history',array['George Washington','John Adams','Thomas Jefferson','James Madison','James Monroe','John Quincy Adams','Andrew Jackson','Martin Van Buren','William Henry Harrison','John Tyler']::text[]);
select public._seed_brainilab_order_up('english-monarchs','English & British monarchs','Put these monarchs in chronological order.','Earliest reign → Latest reign','history',array['Henry VII','Henry VIII','Edward VI','Mary I','Elizabeth I','James I','Charles I','Charles II','James II','William III']::text[]);
select public._seed_brainilab_order_up('history-milestones','History timeline','Put these major events in chronological order.','Earliest → Latest','history',array['Magna Carta is sealed','Columbus reaches the Americas','Martin Luther publishes the 95 Theses','U.S. Declaration of Independence','French Revolution begins','On the Origin of Species is published','World War I begins','World War II begins','Apollo 11 Moon landing','Berlin Wall falls']::text[]);
select public._seed_brainilab_order_up('inventions-timeline','Inventions timeline','Order these inventions or breakthroughs by when they appeared.','Earliest → Latest','science',array['Gutenberg printing press','Telescope','Newcomen steam engine','First permanent photograph','Telephone patent','Practical incandescent light bulb','Powered airplane','Mechanical television demonstration','Transistor','World Wide Web proposal']::text[]);
select public._seed_brainilab_order_up('scientists-birth','Scientists by birth','Order these scientists by birth year.','Oldest → Youngest','science',array['Nicolaus Copernicus','Galileo Galilei','Johannes Kepler','Isaac Newton','Michael Faraday','Charles Darwin','Gregor Mendel','Marie Curie','Albert Einstein','Alan Turing']::text[]);
select public._seed_brainilab_order_up('composers-birth','Composers by birth','Order these composers by birth year.','Oldest → Youngest','culture',array['Antonio Vivaldi','Johann Sebastian Bach','Joseph Haydn','Wolfgang Amadeus Mozart','Ludwig van Beethoven','Franz Schubert','Frédéric Chopin','Richard Wagner','Pyotr Ilyich Tchaikovsky','Claude Debussy']::text[]);
select public._seed_brainilab_order_up('authors-birth','Writers by birth','Order these writers by birth year.','Oldest → Youngest','culture',array['William Shakespeare','Jane Austen','Charles Dickens','Leo Tolstoy','Mark Twain','Thomas Hardy','Oscar Wilde','Virginia Woolf','George Orwell','Maya Angelou']::text[]);
select public._seed_brainilab_order_up('art-movements','Art movements','Put these art movements in chronological order.','Earlier → Later','culture',array['Renaissance','Baroque','Rococo','Neoclassicism','Romanticism','Realism','Impressionism','Post-Impressionism','Cubism','Surrealism']::text[]);
select public._seed_brainilab_order_up('movies-release','Movie timeline','Order these films by their original release.','Oldest → Newest','culture',array['Snow White and the Seven Dwarfs','Citizen Kane','The Godfather','Jaws','Star Wars','E.T. the Extra-Terrestrial','Jurassic Park','Titanic','The Dark Knight','Parasite']::text[]);
select public._seed_brainilab_order_up('disney-animation','Disney animation timeline','Order these Disney animated films by original release.','Oldest → Newest','culture',array['Snow White and the Seven Dwarfs','Pinocchio','Cinderella','Sleeping Beauty','The Jungle Book','The Little Mermaid','Beauty and the Beast','Aladdin','The Lion King','Frozen']::text[]);
select public._seed_brainilab_order_up('tech-products','Tech product timeline','Order these products by their original launch.','Oldest → Newest','science',array['Sony Walkman','IBM PC','Apple Macintosh','Nintendo Game Boy','Sony PlayStation','DVD','Apple iPod','Apple iPhone','Apple iPad','Apple Watch']::text[]);
select public._seed_brainilab_order_up('programming-languages','Programming languages','Order these programming languages by when they first appeared.','Oldest → Newest','science',array['Fortran','Lisp','COBOL','BASIC','C','C++','Python','Java','C#','Swift']::text[]);
select public._seed_brainilab_order_up('atomic-number','Chemical elements','Order these elements by atomic number.','Lowest → Highest','science',array['Hydrogen','Carbon','Oxygen','Sodium','Aluminium','Chlorine','Potassium','Iron','Copper','Gold']::text[]);
select public._seed_brainilab_order_up('solar-system-size','Solar System bodies','Order these objects by diameter.','Largest → Smallest','science',array['Sun','Jupiter','Saturn','Uranus','Neptune','Earth','Venus','Mars','Ganymede','Titan']::text[]);
select public._seed_brainilab_order_up('moons-size','Largest moons','Order these moons by diameter.','Largest → Smallest','science',array['Ganymede','Titan','Callisto','Io','Moon','Europa','Triton','Titania','Rhea','Oberon']::text[]);
select public._seed_brainilab_order_up('mountains-height','Highest mountains','Order these mountains by height above sea level.','Highest → Lowest','geography',array['Mount Everest','K2','Kangchenjunga','Lhotse','Makalu','Cho Oyu','Dhaulagiri I','Manaslu','Nanga Parbat','Annapurna I']::text[]);
select public._seed_brainilab_order_up('europe-cities-latitude','European cities','Order these cities from north to south.','North → South','geography',array['Reykjavík','Helsinki','Oslo','Tallinn','Stockholm','Riga','Copenhagen','Dublin','Berlin','Paris']::text[]);
select public._seed_brainilab_order_up('world-cities-latitude','World cities','Order these cities from north to south.','North → South','geography',array['Reykjavík','London','Paris','Rome','New York City','Cairo','Mexico City','Singapore','Sydney','Buenos Aires']::text[]);
select public._seed_brainilab_order_up('football-clubs-founded','Football clubs','Order these clubs by founding year.','Oldest → Newest','sports',array['Manchester United','Arsenal','Liverpool','FC Barcelona','Bayern Munich','Real Madrid','Chelsea','Inter Milan','Borussia Dortmund','Paris Saint-Germain']::text[]);
select public._seed_brainilab_order_up('f1-first-titles','Formula 1 champions','Order these drivers by when they won their first F1 World Championship.','Earliest first title → Latest','sports',array['Juan Manuel Fangio','Alberto Ascari','Mike Hawthorn','Jack Brabham','Graham Hill','Jim Clark','John Surtees','Denny Hulme','Jackie Stewart','Emerson Fittipaldi']::text[]);
select public._seed_brainilab_order_up('space-milestones','Space milestones','Put these space milestones in chronological order.','Earliest → Latest','science',array['Sputnik 1','Yuri Gagarin orbits Earth','Valentina Tereshkova flies to space','Apollo 8 orbits the Moon','Apollo 11 Moon landing','Salyut 1 launches','Voyager 1 launches','Hubble Space Telescope launches','First ISS module launches','James Webb Space Telescope launches']::text[]);
select public._seed_brainilab_order_up('computing-milestones','Computing milestones','Put these computing milestones in chronological order.','Earliest → Latest','science',array['ENIAC is unveiled','Transistor invented','Integrated circuit demonstrated','ARPANET goes online','Intel 4004 released','Apple I released','IBM PC released','World Wide Web proposed','Google founded','iPhone launched']::text[]);
select public._seed_brainilab_order_up('internet-launches','Internet brands','Order these services by launch year.','Oldest → Newest','culture',array['Amazon','eBay','Google','Wikipedia','LinkedIn','Facebook','YouTube','Twitter / X','WhatsApp','Instagram']::text[]);
select public._seed_brainilab_order_up('albums-release','Album timeline','Order these albums by original release.','Oldest → Newest','culture',array['Sgt. Pepper''s Lonely Hearts Club Band','The Dark Side of the Moon','Thriller','Purple Rain','Nevermind','OK Computer','The Marshall Mathers LP','Back to Black','21','1989']::text[]);
select public._seed_brainilab_order_up('bands-formed','Bands by formation','Order these bands by formation year.','Oldest → Newest','culture',array['The Beatles','The Rolling Stones','Pink Floyd','Queen','ABBA','U2','Metallica','Radiohead','Nirvana','Coldplay']::text[]);
select public._seed_brainilab_order_up('books-publication','Book timeline','Order these books by first publication.','Oldest → Newest','culture',array['Don Quixote','Robinson Crusoe','Pride and Prejudice','Frankenstein','Moby-Dick','Alice''s Adventures in Wonderland','Dracula','Nineteen Eighty-Four','The Fellowship of the Ring','Harry Potter and the Philosopher''s Stone']::text[]);
select public._seed_brainilab_order_up('landmarks-completed','Landmark timeline','Order these landmarks by completion or opening.','Oldest → Newest','geography',array['Statue of Liberty','Eiffel Tower','Tower Bridge','Empire State Building','Golden Gate Bridge','Gateway Arch','Sydney Opera House','CN Tower','Petronas Towers','Burj Khalifa']::text[]);
select public._seed_brainilab_order_up('best-picture-timeline','Best Picture winners','Order these Best Picture winners by film release.','Oldest → Newest','culture',array['Wings','Gone with the Wind','Casablanca','On the Waterfront','Lawrence of Arabia','The Godfather','Rocky','Schindler''s List','The Lord of the Rings: The Return of the King','Parasite']::text[]);
select public._seed_brainilab_order_up('music-tech','Music technology','Order these music technologies by introduction.','Oldest → Newest','culture',array['Phonograph','Gramophone','Radio broadcasting','Vinyl LP','Compact cassette','Sony Walkman','Compact Disc','MP3 format','Apple iPod','Spotify']::text[]);
select public._seed_brainilab_order_up('medical-breakthroughs','Medical breakthroughs','Put these medical milestones in chronological order.','Earliest → Latest','science',array['Smallpox vaccine','Ether anesthesia demonstration','Germ theory of disease','X-rays discovered','Insulin discovered','Penicillin discovered','DNA double-helix structure described','First successful kidney transplant','Smallpox declared eradicated','Human Genome Project completed']::text[]);
select public._seed_brainilab_order_up('aviation-milestones','Aviation milestones','Put these aviation milestones in chronological order.','Earliest → Latest','science',array['First crewed hot-air balloon flight','Wright Flyer','First nonstop transatlantic flight','Lindbergh''s solo Atlantic flight','First jet aircraft flight','Sound barrier broken','Boeing 747 enters service','Concorde enters service','Space Shuttle Columbia first flight','Airbus A380 enters service']::text[]);
select public._seed_brainilab_order_up('exploration-milestones','Exploration milestones','Put these exploration milestones in chronological order.','Earliest → Latest','history',array['Columbus reaches the Americas','Magellan expedition departs','James Cook''s Endeavour voyage begins','Lewis and Clark expedition departs','Amundsen reaches the South Pole','First ascent of Mount Everest','Trieste reaches Challenger Deep','Yuri Gagarin orbits Earth','Apollo 11 Moon landing','Voyager 1 enters interstellar space']::text[]);
select public._seed_brainilab_order_up('skyscrapers-completed','Skyscraper timeline','Order these skyscrapers by completion.','Oldest → Newest','geography',array['Flatiron Building','Woolworth Building','Chrysler Building','Empire State Building','Original World Trade Center','Sears / Willis Tower','Petronas Towers','Taipei 101','Burj Khalifa','Shanghai Tower']::text[]);
select public._seed_brainilab_order_up('skeleton-top-bottom','Human skeleton','Order these bones or bone groups from top to bottom in the body.','Top → Bottom','science',array['Skull','Mandible','Cervical vertebrae','Sternum','Lumbar vertebrae','Pelvis','Femur','Patella','Tibia','Talus']::text[]);
select public._seed_brainilab_order_up('paintings-timeline','Famous paintings','Order these paintings by when they were created.','Oldest → Newest','culture',array['Mona Lisa','The Night Watch','Girl with a Pearl Earring','The Third of May 1808','Liberty Leading the People','Impression, Sunrise','The Starry Night','The Scream','Les Demoiselles d''Avignon','The Persistence of Memory']::text[]);
select public._seed_brainilab_order_up('architecture-styles','Architecture styles','Put these architectural styles in chronological order.','Earlier → Later','culture',array['Romanesque','Gothic','Renaissance','Baroque','Rococo','Neoclassical','Gothic Revival','Art Nouveau','Art Deco','Brutalism']::text[]);
select public._seed_brainilab_order_up('europe-capitals-longitude','European capitals','Order these capitals from west to east.','West → East','geography',array['Lisbon','Madrid','London','Paris','Rome','Berlin','Stockholm','Athens','Helsinki','Bucharest']::text[]);

drop function if exists public._seed_brainilab_order_up(
  text,text,text,text,text,text[]
);


-- ============================================================
-- DAILY ORDER UP GENERATION
-- ============================================================

create or replace function public.ensure_brainilab_order_up(
  p_daily_challenge_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_date date;
  v_launch date;
  v_cooldown integer;
  v_position integer;
  v_round_id uuid;
  v_count integer;
begin
  -- Serialize generation for this Daily so two concurrent maintenance/admin
  -- calls cannot race while assigning positions 1 and 2.
  perform 1
  from public.daily_challenges dc_lock
  where dc_lock.id=p_daily_challenge_id
  for update;

  select
    dc.challenge_date,
    ous.launch_date,
    ous.cooldown_days
  into
    v_date,
    v_launch,
    v_cooldown
  from public.daily_challenges dc
  cross join public.order_up_settings ous
  where dc.id=p_daily_challenge_id
    and ous.singleton=true;

  if v_date is null then
    raise exception 'Daily challenge not found';
  end if;

  if v_date<v_launch then
    return;
  end if;

  for v_position in 1..2
  loop
    if exists(
      select 1
      from public.daily_order_up_rounds dour
      where dour.daily_challenge_id=p_daily_challenge_id
        and dour.position=v_position
    ) then
      continue;
    end if;

    v_round_id:=null;

    -- Prefer a valid round that has not appeared during the cooldown.
    select our.id
      into v_round_id
    from public.order_up_rounds our
    where our.is_active=true
      and (
        select count(*)
        from public.order_up_items oui
        where oui.round_id=our.id
      )=10
      and not exists(
        select 1
        from public.daily_order_up_rounds current_dour
        where current_dour.daily_challenge_id=p_daily_challenge_id
          and current_dour.round_id=our.id
      )
      and not exists(
        select 1
        from public.daily_order_up_rounds old
        join public.daily_challenges odc
          on odc.id=old.daily_challenge_id
        where old.round_id=our.id
          and odc.challenge_date<v_date
          and odc.challenge_date>=v_date-v_cooldown
      )
    order by md5(
      our.id::text
      ||':orderup:'
      ||v_date::text
      ||':'
      ||v_position::text
    )
    limit 1;

    -- Fallback: least recently used valid round, still never duplicate
    -- the two rounds inside one Daily.
    if v_round_id is null then
      select our.id
        into v_round_id
      from public.order_up_rounds our
      where our.is_active=true
        and (
          select count(*)
          from public.order_up_items oui
          where oui.round_id=our.id
        )=10
        and not exists(
          select 1
          from public.daily_order_up_rounds current_dour
          where current_dour.daily_challenge_id=p_daily_challenge_id
            and current_dour.round_id=our.id
        )
      order by (
        select max(odc.challenge_date)
        from public.daily_order_up_rounds old
        join public.daily_challenges odc
          on odc.id=old.daily_challenge_id
        where old.round_id=our.id
      ) asc nulls first,
      md5(
        our.id::text
        ||':orderup-fallback:'
        ||v_date::text
        ||':'
        ||v_position::text
      )
      limit 1;
    end if;

    if v_round_id is null then
      raise exception 'No eligible Order Up round is available';
    end if;

    insert into public.daily_order_up_rounds(
      daily_challenge_id,
      position,
      round_id
    )
    values(
      p_daily_challenge_id,
      v_position,
      v_round_id
    );
  end loop;

  select count(*)::integer
    into v_count
  from public.daily_order_up_rounds
  where daily_challenge_id=p_daily_challenge_id;

  if v_count<>2 then
    raise exception 'Order Up Daily must contain exactly 2 rounds, got %',v_count;
  end if;
end;
$$;

revoke execute on function public.ensure_brainilab_order_up(uuid)
  from public,anon,authenticated;


-- Step 16: newly generated Daily rows no longer generate Flag Dash.
-- BrainiWord remains here; Topic Rush and Order Up are generated separately.
create or replace function public.ensure_brainilab_daily_games(
  p_daily_challenge_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_date date;
  v_word_id uuid;
begin
  select challenge_date
    into v_date
  from public.daily_challenges
  where id=p_daily_challenge_id;

  if v_date is null then
    raise exception 'Daily challenge not found';
  end if;

  if not exists(
    select 1
    from public.daily_brainiword
    where daily_challenge_id=p_daily_challenge_id
  ) then
    select bw.id
      into v_word_id
    from public.brainiword_words bw
    where bw.is_active=true
      and not exists(
        select 1
        from public.daily_brainiword dbw
        join public.daily_challenges dc
          on dc.id=dbw.daily_challenge_id
        where dbw.word_id=bw.id
          and dc.challenge_date<v_date
          and dc.challenge_date>=v_date-60
      )
    order by md5(bw.id::text||':'||v_date::text)
    limit 1;

    if v_word_id is null then
      select bw.id
        into v_word_id
      from public.brainiword_words bw
      where bw.is_active=true
      order by (
        select max(dc.challenge_date)
        from public.daily_brainiword old
        join public.daily_challenges dc
          on dc.id=old.daily_challenge_id
        where old.word_id=bw.id
      ) asc nulls first,
      md5(bw.id::text||':'||v_date::text)
      limit 1;
    end if;

    if v_word_id is null then
      raise exception 'No active BrainiWord is available';
    end if;

    insert into public.daily_brainiword(
      daily_challenge_id,
      word_id
    )
    values(
      p_daily_challenge_id,
      v_word_id
    );
  end if;
end;
$$;

revoke execute on function public.ensure_brainilab_daily_games(uuid)
  from public,anon,authenticated;


create or replace function public.handle_brainilab_daily_games_generation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.ensure_brainilab_daily_games(new.id);
  perform public.ensure_brainilab_topic_rush(new.id);
  perform public.ensure_brainilab_order_up(new.id);
  return new;
end;
$$;


-- Keep today's Flag Dash rows so pending historical verification remains safe.
-- Future generated rows are no longer used and can be removed.
delete from public.daily_flag_dash_questions dfd
using public.daily_challenges dc
where dc.id=dfd.daily_challenge_id
  and dc.challenge_date>(now() at time zone 'UTC')::date;


-- Backfill Order Up for today and all already-generated future Daily rows.
do $$
declare
  v_daily record;
  v_launch date;
begin
  select launch_date
    into v_launch
  from public.order_up_settings
  where singleton=true;

  for v_daily in
    select dc.id
    from public.daily_challenges dc
    where dc.challenge_date>=v_launch
    order by dc.challenge_date
  loop
    perform public.ensure_brainilab_order_up(v_daily.id);
  end loop;
end;
$$;


-- ============================================================
-- ORDER UP SCORING / GAMEPLAY RPCs
-- ============================================================

create or replace function public.brainilab_score_order_up_round(
  p_round_id uuid,
  p_item_ids jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_exact integer:=0;
  v_pairs integer:=0;
  v_score integer:=0;
  v_accuracy numeric:=0;
  v_correct_order jsonb;
begin
  if jsonb_typeof(coalesce(p_item_ids,'[]'::jsonb))<>'array'
     or jsonb_array_length(p_item_ids)<>10 then
    raise exception 'Order Up requires exactly 10 submitted items';
  end if;

  if (
    select count(distinct x.value)
    from jsonb_array_elements_text(p_item_ids) x(value)
  )<>10 then
    raise exception 'Order Up submitted items must be unique';
  end if;

  if exists(
    select 1
    from jsonb_array_elements_text(p_item_ids) x(value)
    left join public.order_up_items oui
      on oui.id::text=x.value
     and oui.round_id=p_round_id
    where oui.id is null
  ) then
    raise exception 'Order Up submission contains an invalid item';
  end if;

  with submitted as (
    select
      x.value::uuid as item_id,
      x.ordinality::integer as submitted_position
    from jsonb_array_elements_text(p_item_ids)
      with ordinality as x(value,ordinality)
  ),
  enriched as (
    select
      s.item_id,
      s.submitted_position,
      oui.sort_position
    from submitted s
    join public.order_up_items oui
      on oui.id=s.item_id
     and oui.round_id=p_round_id
  )
  select count(*)::integer
    into v_exact
  from enriched e
  where e.submitted_position=e.sort_position;

  with submitted as (
    select
      x.value::uuid as item_id,
      x.ordinality::integer as submitted_position
    from jsonb_array_elements_text(p_item_ids)
      with ordinality as x(value,ordinality)
  ),
  enriched as (
    select
      s.item_id,
      s.submitted_position,
      oui.sort_position
    from submitted s
    join public.order_up_items oui
      on oui.id=s.item_id
     and oui.round_id=p_round_id
  )
  select count(*)::integer
    into v_pairs
  from enriched a
  join enriched b
    on a.submitted_position<b.submitted_position
  where a.sort_position<b.sort_position;

  v_score:=least(
    1250,
    greatest(
      0,
      round(v_pairs::numeric/45.0*1250)::integer
    )
  );

  v_accuracy:=round(
    v_pairs::numeric/45.0*100,
    2
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'item_id',oui.id,
        'label',oui.label
      )
      order by oui.sort_position
    ),
    '[]'::jsonb
  )
  into v_correct_order
  from public.order_up_items oui
  where oui.round_id=p_round_id;

  return jsonb_build_object(
    'score',v_score,
    'exact_positions',v_exact,
    'correct_pairs',v_pairs,
    'total_pairs',45,
    'accuracy',v_accuracy,
    'correct_order',v_correct_order
  );
end;
$$;

revoke execute on function public.brainilab_score_order_up_round(uuid,jsonb)
  from public,anon,authenticated;


create or replace function public.get_brainilab_daily_order_up()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_today date:=(now() at time zone 'UTC')::date;
  v_payload jsonb;
begin
  select jsonb_build_object(
    'daily_challenge_id',dc.id,
    'daily_number',dc.daily_number,
    'challenge_date',dc.challenge_date,
    'rounds',(
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'round_id',our.id,
            'position',dour.position,
            'title',our.title,
            'prompt',our.prompt,
            'direction_label',our.direction_label,
            'items',(
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'item_id',oui.id,
                    'label',oui.label
                  )
                  order by md5(
                    oui.id::text
                    ||':'
                    ||dc.challenge_date::text
                    ||':'
                    ||dour.position::text
                  )
                ),
                '[]'::jsonb
              )
              from public.order_up_items oui
              where oui.round_id=our.id
            )
          )
          order by dour.position
        ),
        '[]'::jsonb
      )
      from public.daily_order_up_rounds dour
      join public.order_up_rounds our
        on our.id=dour.round_id
      where dour.daily_challenge_id=dc.id
    )
  )
  into v_payload
  from public.daily_challenges dc
  where dc.challenge_date=v_today
    and dc.status='published'
  order by dc.generation_version desc
  limit 1;

  if v_payload is null then
    raise exception 'Today''s Order Up is not available';
  end if;

  if jsonb_array_length(v_payload->'rounds')<>2 then
    raise exception 'Today''s Order Up is incomplete';
  end if;

  return v_payload;
end;
$$;

revoke execute on function public.get_brainilab_daily_order_up()
  from public;

grant execute on function public.get_brainilab_daily_order_up()
  to anon,authenticated;


create or replace function public.check_brainilab_order_up_round(
  p_daily_challenge_id uuid,
  p_round_id uuid,
  p_item_ids jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_today date:=(now() at time zone 'UTC')::date;
  v_eval jsonb;
begin
  if not exists(
    select 1
    from public.daily_challenges dc
    join public.daily_order_up_rounds dour
      on dour.daily_challenge_id=dc.id
    where dc.id=p_daily_challenge_id
      and dc.challenge_date=v_today
      and dc.status='published'
      and dour.round_id=p_round_id
  ) then
    raise exception 'Order Up round is not part of today''s Daily';
  end if;

  v_eval:=public.brainilab_score_order_up_round(
    p_round_id,
    p_item_ids
  );

  return v_eval;
end;
$$;

revoke execute on function public.check_brainilab_order_up_round(
  uuid,uuid,jsonb
) from public;

grant execute on function public.check_brainilab_order_up_round(
  uuid,uuid,jsonb
) to anon,authenticated;


create or replace function public.verify_brainilab_order_up_result(
  p_client_result_id text,
  p_daily_challenge_id uuid,
  p_rounds jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid:=auth.uid();
  v_session_id uuid;
  v_result_id uuid;
  v_daily_number integer;
  v_round record;
  v_submission jsonb;
  v_eval jsonb;
  v_score integer:=0;
  v_exact integer:=0;
  v_pairs integer:=0;
  v_accuracy numeric:=0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(coalesce(p_rounds,'[]'::jsonb))<>'array'
     or jsonb_array_length(p_rounds)<>2 then
    raise exception 'Order Up verification requires exactly 2 rounds';
  end if;

  select
    gs.id,
    gr.id
  into
    v_session_id,
    v_result_id
  from public.game_sessions gs
  join public.game_results gr
    on gr.session_id=gs.id
  where gs.user_id=v_user_id
    and gs.client_result_id=p_client_result_id
    and gs.game_id='orderup'
  limit 1;

  if v_result_id is null then
    raise exception 'Order Up result not found';
  end if;

  select dc.daily_number
    into v_daily_number
  from public.daily_challenges dc
  where dc.id=p_daily_challenge_id
    and dc.status in ('published','retired');

  if v_daily_number is null then
    raise exception 'Order Up Daily not found';
  end if;

  if (
    select count(*)
    from public.daily_order_up_rounds dour
    where dour.daily_challenge_id=p_daily_challenge_id
  )<>2 then
    raise exception 'Order Up Daily does not contain exactly 2 rounds';
  end if;

  for v_round in
    select
      dour.position,
      dour.round_id
    from public.daily_order_up_rounds dour
    where dour.daily_challenge_id=p_daily_challenge_id
    order by dour.position
  loop
    select x.value
      into v_submission
    from jsonb_array_elements(p_rounds) x(value)
    where x.value->>'round_id'=v_round.round_id::text
    limit 1;

    if v_submission is null then
      raise exception 'Missing Order Up round %',v_round.position;
    end if;

    v_eval:=public.brainilab_score_order_up_round(
      v_round.round_id,
      v_submission->'item_ids'
    );

    v_score:=v_score+coalesce((v_eval->>'score')::integer,0);
    v_exact:=v_exact+coalesce((v_eval->>'exact_positions')::integer,0);
    v_pairs:=v_pairs+coalesce((v_eval->>'correct_pairs')::integer,0);
  end loop;

  v_score:=least(2500,greatest(0,v_score));
  v_accuracy:=round(v_pairs::numeric/90.0*100,2);

  update public.game_sessions
  set
    daily_challenge_id=p_daily_challenge_id,
    daily_number=v_daily_number
  where id=v_session_id;

  update public.game_results
  set
    score=v_score,
    correct_answers=v_exact,
    total_questions=20,
    accuracy=v_accuracy,
    answers_verified=true,
    verified_correct_answers=v_exact,
    verified_total_questions=20,
    answers_verified_at=now(),
    result_payload=
      coalesce(result_payload,'{}'::jsonb)
      || jsonb_build_object(
        'verifiedOrderPairsCorrect',v_pairs,
        'verifiedOrderPairsTotal',90,
        'verifiedOrderAccuracy',v_accuracy,
        'verifiedOrderUpRounds',2
      )
  where id=v_result_id;

  return jsonb_build_object(
    'answers_verified',true,
    'daily_number',v_daily_number,
    'correct',v_exact,
    'total',20,
    'accuracy',v_accuracy,
    'score',v_score,
    'daily_points',v_score,
    'correct_pairs',v_pairs,
    'total_pairs',90,
    'server_score_verified',false
  );
end;
$$;

revoke execute on function public.verify_brainilab_order_up_result(
  text,uuid,jsonb
) from public,anon;

grant execute on function public.verify_brainilab_order_up_result(
  text,uuid,jsonb
) to authenticated;


-- ============================================================
-- PLAYER DAILY STATS
-- ============================================================

alter table public.player_daily_stats
  add column if not exists orderup_points integer not null default 0;

alter table public.player_daily_stats
  drop constraint if exists player_daily_points_range;

alter table public.player_daily_stats
  add constraint player_daily_points_range
  check(
    brainmix_points between 0 and 2500
    and flagdash_points between 0 and 2500
    and orderup_points between 0 and 2500
    and maphunt_points between 0 and 2500
    and topicrush_points between 0 and 2500
    and brainiword_points between 0 and 2500
    and daily_brain_score between 0 and 10000
  );

create index if not exists player_daily_orderup_rank_idx
  on public.player_daily_stats(stat_date,orderup_points desc);



create or replace function public.brainilab_daily_game_points(
  p_game_id text,
  p_score integer,
  p_correct integer,
  p_payload jsonb
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v_points integer := 0;
  v_attempts integer;
  v_won boolean := false;
  v_best_combo integer := 0;
begin
  if p_game_id = 'brainmix' then
    v_points := least(
      2500,
      greatest(0,round(coalesce(p_score,0) * 0.25)::integer)
    );

  elsif p_game_id = 'flagdash' then
    begin
      v_best_combo := coalesce((p_payload ->> 'bestCombo')::integer,0);
    exception when others then
      v_best_combo := 0;
    end;

    v_points := least(
      2500,
      greatest(
        0,
        coalesce(p_correct,0) * 70 + v_best_combo * 15
      )
    );

  elsif p_game_id = 'orderup' then
    -- Order Up is verified directly on a canonical 0–2,500 scale.
    v_points := least(
      2500,
      greatest(0,coalesce(p_score,0))
    );

  elsif p_game_id = 'topicrush' then
    -- Topic Rush final score is already the canonical 0–2,500 Daily contribution.
    v_points := least(
      2500,
      greatest(0,coalesce(p_score,0))
    );

  elsif p_game_id = 'maphunt' then
    -- Legacy Map Hunt scoring remains for historical days before Topic Rush launch.
    v_points := least(
      2500,
      greatest(0,round(coalesce(p_score,0) * 0.42)::integer)
    );

  elsif p_game_id = 'brainiword' then
    v_won := lower(coalesce(p_payload ->> 'won','false')) = 'true';

    begin
      v_attempts := (p_payload ->> 'attempts')::integer;
    exception when others then
      v_attempts := null;
    end;

    if not v_won then
      v_points := 250;
    else
      v_points := case v_attempts
        when 1 then 2500
        when 2 then 2250
        when 3 then 2000
        when 4 then 1750
        when 5 then 1500
        else 1000
      end;
    end if;
  end if;

  return least(2500,greatest(0,coalesce(v_points,0)));
end;
$$;


create or replace function public.refresh_brainilab_player_progression(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_current_streak integer := 0;
  v_best_streak integer := 0;
  v_run integer := 0;
  v_previous_date date := null;
  v_last_streak_date date := null;

  v_total_games integer := 0;
  v_total_questions bigint := 0;
  v_full_daily_count integer := 0;
  v_xp bigint := 0;
  v_level integer := 1;
  v_favorite_game text := null;
  v_last_active_at timestamptz := null;

  v_day record;
  v_topicrush_launch_date date;
  v_orderup_launch_date date;
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.player_progression(user_id)
  values(p_user_id)
  on conflict(user_id) do nothing;

  select trs.launch_date
    into v_topicrush_launch_date
  from public.topic_rush_settings trs
  where trs.singleton=true;

  v_topicrush_launch_date:=coalesce(v_topicrush_launch_date,current_date);

  select ous.launch_date
    into v_orderup_launch_date
  from public.order_up_settings ous
  where ous.singleton=true;

  v_orderup_launch_date:=coalesce(v_orderup_launch_date,current_date);

  -- ----------------------------------------------------------
  -- Rebuild daily stats for this user.
  -- ----------------------------------------------------------

  delete from public.player_daily_stats
  where user_id = p_user_id;

  insert into public.player_daily_stats(
    user_id,
    stat_date,
    games_played,
    questions_answered,
    daily_games_completed,
    full_daily,
    brainmix_points,
    flagdash_points,
    orderup_points,
    maphunt_points,
    topicrush_points,
    brainiword_points,
    daily_brain_score,
    xp_earned,
    updated_at
  )
  with base as (
    select
      gs.user_id,
      (gs.completed_at at time zone 'UTC')::date as stat_date,
      gs.game_id,
      gr.id as result_id,
      coalesce(gr.score,0) as score,
      coalesce(
        gr.verified_correct_answers,
        gr.correct_answers,
        0
      ) as correct_answers,
      coalesce(
        gr.verified_total_questions,
        gr.total_questions,
        0
      ) as total_questions,
      gr.result_payload,
      public.brainilab_daily_game_points(
        gs.game_id,
        gr.score,
        coalesce(
          gr.verified_correct_answers,
          gr.correct_answers
        ),
        gr.result_payload
      ) as daily_points
    from public.game_sessions gs
    join public.game_results gr
      on gr.session_id = gs.id
    where gs.user_id = p_user_id
      and gs.status = 'completed'
  ),
  daily as (
    select
      user_id,
      stat_date,
      count(*)::integer as games_played,
      coalesce(sum(total_questions),0)::integer as questions_answered,

      (
        count(distinct game_id) filter(
          where game_id in ('brainmix','brainiword')
        )
        +
        case
          when stat_date>=v_orderup_launch_date
            then case when bool_or(game_id='orderup') then 1 else 0 end
          else case when bool_or(game_id='flagdash') then 1 else 0 end
        end
        +
        case
          when stat_date>=v_topicrush_launch_date then
            case
              when bool_or(game_id='topicrush') or bool_or(game_id='maphunt')
                then 1
              else 0
            end
          else
            case when bool_or(game_id='maphunt') then 1 else 0 end
        end
      )::integer as daily_games_completed,

      coalesce(max(daily_points) filter(where game_id='brainmix'),0)::integer
        as brainmix_points,

      coalesce(max(daily_points) filter(where game_id='flagdash'),0)::integer
        as flagdash_points,

      coalesce(max(daily_points) filter(where game_id='orderup'),0)::integer
        as orderup_points,

      coalesce(max(daily_points) filter(where game_id='maphunt'),0)::integer
        as maphunt_points,

      coalesce(max(daily_points) filter(where game_id='topicrush'),0)::integer
        as topicrush_points,

      coalesce(max(daily_points) filter(where game_id='brainiword'),0)::integer
        as brainiword_points,

      coalesce(sum(50 + least(correct_answers,50) * 5),0)::integer
        as base_xp
    from base
    group by user_id,stat_date
  )
  select
    user_id,
    stat_date,
    games_played,
    questions_answered,
    daily_games_completed,
    daily_games_completed = 4,

    brainmix_points,
    flagdash_points,
    orderup_points,
    maphunt_points,
    topicrush_points,
    brainiword_points,

    brainmix_points
      + case
          when stat_date>=v_orderup_launch_date
            then orderup_points
          else flagdash_points
        end
      + brainiword_points
      + case
          when stat_date>=v_topicrush_launch_date
            then greatest(topicrush_points,maphunt_points)
          else maphunt_points
        end,

    base_xp + case when daily_games_completed=4 then 250 else 0 end,
    now()
  from daily;


  -- ----------------------------------------------------------
  -- Rebuild generic week/month aggregates.
  -- ----------------------------------------------------------

  delete from public.player_period_stats
  where user_id = p_user_id;

  insert into public.player_period_stats(
    user_id,
    period_type,
    period_start,
    games_played,
    questions_answered,
    daily_brain_score,
    full_daily_count,
    active_days,
    xp_earned,
    updated_at
  )
  select
    p_user_id,
    periods.period_type,
    periods.period_start,
    sum(ds.games_played)::integer,
    sum(ds.questions_answered)::bigint,
    sum(ds.daily_brain_score)::integer,
    count(*) filter(where ds.full_daily)::integer,
    count(*) filter(where ds.daily_games_completed > 0)::integer,
    sum(ds.xp_earned)::bigint,
    now()
  from public.player_daily_stats ds
  cross join lateral (
    values
      (
        'week'::text,
        date_trunc('week',ds.stat_date::timestamp)::date
      ),
      (
        'month'::text,
        date_trunc('month',ds.stat_date::timestamp)::date
      )
  ) as periods(period_type,period_start)
  where ds.user_id = p_user_id
  group by periods.period_type,periods.period_start;


  -- ----------------------------------------------------------
  -- Rebuild per-game day/week/month aggregates.
  -- ----------------------------------------------------------

  delete from public.player_game_period_stats
  where user_id = p_user_id;

  insert into public.player_game_period_stats(
    user_id,
    game_id,
    period_type,
    period_start,
    games_played,
    total_score,
    best_score,
    total_correct,
    total_questions,
    average_accuracy,
    best_daily_points,
    metric_name,
    best_metric_value,
    updated_at
  )
  with base as (
    select
      gs.user_id,
      gs.game_id,
      (gs.completed_at at time zone 'UTC')::date as stat_date,
      gr.score,
      coalesce(
        gr.verified_correct_answers,
        gr.correct_answers,
        0
      ) as correct_answers,
      coalesce(
        gr.verified_total_questions,
        gr.total_questions,
        0
      ) as total_questions,
      gr.accuracy,
      gr.result_payload,

      public.brainilab_daily_game_points(
        gs.game_id,
        gr.score,
        coalesce(
          gr.verified_correct_answers,
          gr.correct_answers
        ),
        gr.result_payload
      ) as daily_points,

      case
        when gs.game_id='brainiword'
          and lower(coalesce(gr.result_payload ->> 'won','false'))='true'
          then nullif(gr.result_payload ->> 'attempts','')::numeric
        when gs.game_id='flagdash'
          then coalesce(
            gr.verified_correct_answers,
            gr.correct_answers
          )::numeric
        else gr.score::numeric
      end as metric_value
    from public.game_sessions gs
    join public.game_results gr
      on gr.session_id=gs.id
    where gs.user_id=p_user_id
      and gs.status='completed'
  ),
  expanded as (
    select
      b.*,
      periods.period_type,
      periods.period_start
    from base b
    cross join lateral (
      values
        ('day'::text,b.stat_date),
        (
          'week'::text,
          date_trunc('week',b.stat_date::timestamp)::date
        ),
        (
          'month'::text,
          date_trunc('month',b.stat_date::timestamp)::date
        )
    ) as periods(period_type,period_start)
  )
  select
    p_user_id,
    game_id,
    period_type,
    period_start,

    count(*)::integer,
    coalesce(sum(score),0)::bigint,
    max(score),
    coalesce(sum(correct_answers),0)::integer,
    coalesce(sum(total_questions),0)::integer,
    round(avg(accuracy)::numeric,2),
    coalesce(max(daily_points),0)::integer,

    case
      when game_id='brainiword' then 'attempts'
      when game_id='flagdash' then 'correct'
      else 'score'
    end,

    case
      when game_id='brainiword' then min(metric_value)
      else max(metric_value)
    end,

    now()
  from expanded
  group by
    game_id,
    period_type,
    period_start;


  -- ----------------------------------------------------------
  -- Rebuild personal bests.
  -- ----------------------------------------------------------

  delete from public.player_personal_bests
  where user_id = p_user_id;

  insert into public.player_personal_bests(
    user_id,
    game_id,
    result_id,
    metric_name,
    metric_value,
    score,
    correct_answers,
    total_questions,
    accuracy,
    duration_ms,
    result_payload,
    achieved_at,
    updated_at
  )
  with ranked as (
    select
      gs.game_id,
      gr.id as result_id,
      gr.score,
      coalesce(
        gr.verified_correct_answers,
        gr.correct_answers
      ) as correct_answers,
      coalesce(
        gr.verified_total_questions,
        gr.total_questions
      ) as total_questions,
      gr.accuracy,
      gr.duration_ms,
      gr.result_payload,
      gs.completed_at,

      case
        when gs.game_id='brainiword'
          then 'attempts'
        when gs.game_id='flagdash'
          then 'correct'
        else 'score'
      end as metric_name,

      case
        when gs.game_id='brainiword'
          and lower(coalesce(gr.result_payload ->> 'won','false'))='true'
          then nullif(gr.result_payload ->> 'attempts','')::numeric
        when gs.game_id='flagdash'
          then coalesce(
            gr.verified_correct_answers,
            gr.correct_answers
          )::numeric
        else gr.score::numeric
      end as metric_value,

      row_number() over(
        partition by gs.game_id
        order by
          case
            when gs.game_id='brainiword'
              then case
                when lower(coalesce(gr.result_payload ->> 'won','false'))='true'
                  then 0
                else 1
              end
            else 0
          end asc,

          case
            when gs.game_id='brainiword'
              and lower(coalesce(gr.result_payload ->> 'won','false'))='true'
              then nullif(gr.result_payload ->> 'attempts','')::numeric
            else null
          end asc nulls last,

          case
            when gs.game_id='flagdash'
              then coalesce(
                gr.verified_correct_answers,
                gr.correct_answers
              )::numeric
            when gs.game_id<>'brainiword'
              then gr.score::numeric
            else null
          end desc nulls last,

          gr.accuracy desc nulls last,
          gr.duration_ms asc nulls last,
          gs.completed_at asc
      ) as rn
    from public.game_sessions gs
    join public.game_results gr
      on gr.session_id=gs.id
    where gs.user_id=p_user_id
      and gs.status='completed'
  )
  select
    p_user_id,
    game_id,
    result_id,
    metric_name,
    coalesce(metric_value,0),
    score,
    correct_answers,
    total_questions,
    accuracy,
    duration_ms,
    result_payload,
    completed_at,
    now()
  from ranked
  where rn=1
    and metric_value is not null;


  -- ----------------------------------------------------------
  -- Progression totals.
  -- ----------------------------------------------------------

  select
    count(*)::integer,
    coalesce(sum(
      coalesce(
        gr.verified_total_questions,
        gr.total_questions,
        0
      )
    ),0)::bigint,
    max(gs.completed_at)
  into
    v_total_games,
    v_total_questions,
    v_last_active_at
  from public.game_sessions gs
  join public.game_results gr
    on gr.session_id=gs.id
  where gs.user_id=p_user_id
    and gs.status='completed';

  select count(*)::integer
    into v_full_daily_count
  from public.player_daily_stats
  where user_id=p_user_id
    and full_daily=true;

  select coalesce(sum(xp_earned),0)::bigint
    into v_xp
  from public.player_daily_stats
  where user_id=p_user_id;

  v_level := greatest(
    1,
    floor(sqrt(v_xp::numeric / 20.0))::integer + 1
  );

  select gs.game_id
    into v_favorite_game
  from public.game_sessions gs
  where gs.user_id=p_user_id
    and gs.status='completed'
  group by gs.game_id
  order by count(*) desc,gs.game_id
  limit 1;


  -- ----------------------------------------------------------
  -- Streaks: at least one Daily Game on a UTC date.
  -- ----------------------------------------------------------

  for v_day in
    select stat_date
    from public.player_daily_stats
    where user_id=p_user_id
      and daily_games_completed > 0
    order by stat_date
  loop
    if v_previous_date is null
       or v_day.stat_date = v_previous_date + 1 then
      v_run := v_run + 1;
    else
      v_run := 1;
    end if;

    v_best_streak := greatest(v_best_streak,v_run);
    v_previous_date := v_day.stat_date;
    v_last_streak_date := v_day.stat_date;
  end loop;

  if v_last_streak_date is not null
     and v_last_streak_date >= v_today - 1 then

    v_current_streak := 0;
    v_previous_date := null;

    for v_day in
      select stat_date
      from public.player_daily_stats
      where user_id=p_user_id
        and daily_games_completed > 0
        and stat_date <= v_last_streak_date
      order by stat_date desc
    loop
      if v_previous_date is null
         or v_day.stat_date = v_previous_date - 1 then
        v_current_streak := v_current_streak + 1;
        v_previous_date := v_day.stat_date;
      else
        exit;
      end if;
    end loop;
  else
    v_current_streak := 0;
  end if;

  update public.player_progression
  set
    current_streak=v_current_streak,
    best_streak=v_best_streak,
    full_daily_count=v_full_daily_count,
    xp=v_xp,
    level=v_level,
    total_games=v_total_games,
    total_questions=v_total_questions,
    favorite_game_id=v_favorite_game,
    last_streak_date=v_last_streak_date,
    last_active_at=v_last_active_at,
    updated_at=now()
  where user_id=p_user_id;
end;
$$;


create or replace function public.get_my_brainilab_progression()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'UTC')::date;
  v_week date := date_trunc(
    'week',
    (now() at time zone 'UTC')
  )::date;
  v_month date := date_trunc(
    'month',
    (now() at time zone 'UTC')
  )::date;

  v_daily_number integer;
  v_progression jsonb;
  v_today_stats jsonb;
  v_week_stats jsonb;
  v_month_stats jsonb;
  v_personal_bests jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select dc.daily_number
    into v_daily_number
  from public.daily_challenges dc
  where dc.challenge_date=v_today
  order by dc.generation_version desc
  limit 1;

  select to_jsonb(pp)
    into v_progression
  from public.player_progression pp
  where pp.user_id=v_user_id;

  select jsonb_build_object(
    'stat_date',v_today,
    'daily_number',v_daily_number,
    'games_played',coalesce(ds.games_played,0),
    'questions_answered',coalesce(ds.questions_answered,0),
    'daily_games_completed',coalesce(ds.daily_games_completed,0),
    'full_daily',coalesce(ds.full_daily,false),
    'brainmix_points',coalesce(ds.brainmix_points,0),
    'flagdash_points',coalesce(ds.flagdash_points,0),
    'orderup_points',coalesce(ds.orderup_points,0),
    'maphunt_points',coalesce(ds.maphunt_points,0),
    'topicrush_points',greatest(
      coalesce(ds.topicrush_points,0),
      coalesce(ds.maphunt_points,0)
    ),
    'brainiword_points',coalesce(ds.brainiword_points,0),

    'brainmix_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='brainmix'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),
    'flagdash_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='flagdash'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),
    'orderup_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='orderup'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),
    'maphunt_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='maphunt'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),
    'topicrush_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id in ('topicrush','maphunt')
        and gps.period_type='day'
        and gps.period_start=v_today
    ),
    'brainiword_played',exists(
      select 1
      from public.player_game_period_stats gps
      where gps.user_id=v_user_id
        and gps.game_id='brainiword'
        and gps.period_type='day'
        and gps.period_start=v_today
    ),

    'daily_brain_score',coalesce(ds.daily_brain_score,0),
    'xp_earned',coalesce(ds.xp_earned,0)
  )
  into v_today_stats
  from (select 1) seed
  left join public.player_daily_stats ds
    on ds.user_id=v_user_id
   and ds.stat_date=v_today;

  select coalesce(
    to_jsonb(ps),
    jsonb_build_object(
      'period_type','week',
      'period_start',v_week,
      'games_played',0,
      'questions_answered',0,
      'daily_brain_score',0,
      'full_daily_count',0,
      'active_days',0,
      'xp_earned',0
    )
  )
  into v_week_stats
  from (select 1) seed
  left join public.player_period_stats ps
    on ps.user_id=v_user_id
   and ps.period_type='week'
   and ps.period_start=v_week;

  select coalesce(
    to_jsonb(ps),
    jsonb_build_object(
      'period_type','month',
      'period_start',v_month,
      'games_played',0,
      'questions_answered',0,
      'daily_brain_score',0,
      'full_daily_count',0,
      'active_days',0,
      'xp_earned',0
    )
  )
  into v_month_stats
  from (select 1) seed
  left join public.player_period_stats ps
    on ps.user_id=v_user_id
   and ps.period_type='month'
   and ps.period_start=v_month;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'game_id',pb.game_id,
        'result_id',pb.result_id,
        'metric_name',pb.metric_name,
        'metric_value',pb.metric_value,
        'score',pb.score,
        'correct_answers',pb.correct_answers,
        'total_questions',pb.total_questions,
        'accuracy',pb.accuracy,
        'duration_ms',pb.duration_ms,
        'result_payload',pb.result_payload,
        'achieved_at',pb.achieved_at
      )
      order by pb.game_id
    ),
    '[]'::jsonb
  )
  into v_personal_bests
  from public.player_personal_bests pb
  where pb.user_id=v_user_id;

  return jsonb_build_object(
    'progression',coalesce(
      v_progression,
      jsonb_build_object(
        'user_id',v_user_id,
        'current_streak',0,
        'best_streak',0,
        'full_daily_count',0,
        'xp',0,
        'level',1,
        'total_games',0,
        'total_questions',0,
        'favorite_game_id',null
      )
    ),
    'today',v_today_stats,
    'week',v_week_stats,
    'month',v_month_stats,
    'personal_bests',v_personal_bests,
    'generated_at',now()
  );
end;
$$;


-- ============================================================
-- FINAL RANKING HELPERS — Topic Rush is a normalized Daily game
-- ============================================================


create or replace function public.brainilab_player_rank_value(
  p_user_id uuid,
  p_period text,
  p_game_id text,
  p_metric text
)
returns bigint
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_period text:=lower(coalesce(p_period,'daily'));
  v_game text:=lower(coalesce(p_game_id,'all'));
  v_metric text:=lower(coalesce(p_metric,'score'));

  v_today date:=(now() at time zone 'UTC')::date;
  v_week date:=date_trunc(
    'week',
    (now() at time zone 'UTC')
  )::date;
  v_month date:=date_trunc(
    'month',
    (now() at time zone 'UTC')
  )::date;

  v_value bigint:=0;
  v_period_type text;
  v_period_start date;
begin
  if p_user_id is null then
    return 0;
  end if;

  if v_metric='streak' then
    select coalesce(pp.current_streak,0)::bigint
      into v_value
    from public.player_progression pp
    where pp.user_id=p_user_id;

    return coalesce(v_value,0);
  end if;

  if v_period not in ('daily','weekly','monthly') then
    return 0;
  end if;

  -- All games: Daily Brain Score.
  if v_game='all' then
    if v_period='daily' then
      select coalesce(ds.daily_brain_score,0)::bigint
        into v_value
      from public.player_daily_stats ds
      where ds.user_id=p_user_id
        and ds.stat_date=v_today;
    elsif v_period='weekly' then
      select coalesce(ps.daily_brain_score,0)::bigint
        into v_value
      from public.player_period_stats ps
      where ps.user_id=p_user_id
        and ps.period_type='week'
        and ps.period_start=v_week;
    else
      select coalesce(ps.daily_brain_score,0)::bigint
        into v_value
      from public.player_period_stats ps
      where ps.user_id=p_user_id
        and ps.period_type='month'
        and ps.period_start=v_month;
    end if;

    return coalesce(v_value,0);
  end if;

  -- Daily games use normalized Daily Brain Score contribution points.
  if v_game in ('brainmix','flagdash','orderup','maphunt','topicrush','brainiword') then
    select coalesce(
      sum(
        case v_game
          when 'brainmix' then ds.brainmix_points
          when 'flagdash' then ds.flagdash_points
          when 'orderup' then ds.orderup_points
          when 'maphunt' then ds.maphunt_points
          when 'topicrush' then case
            when ds.stat_date >= (
              select trs.launch_date
              from public.topic_rush_settings trs
              where trs.singleton=true
            )
              then greatest(ds.topicrush_points,ds.maphunt_points)
            else 0
          end
          when 'brainiword' then ds.brainiword_points
          else 0
        end
      ),
      0
    )::bigint
    into v_value
    from public.player_daily_stats ds
    where ds.user_id=p_user_id
      and (
        (v_period='daily' and ds.stat_date=v_today)
        or
        (
          v_period='weekly'
          and ds.stat_date between v_week and v_today
        )
        or
        (
          v_period='monthly'
          and ds.stat_date between v_month and v_today
        )
      );

    return coalesce(v_value,0);
  end if;

  -- Evergreen game score.
  if v_period='daily' then
    v_period_type:='day';
    v_period_start:=v_today;
  elsif v_period='weekly' then
    v_period_type:='week';
    v_period_start:=v_week;
  else
    v_period_type:='month';
    v_period_start:=v_month;
  end if;

  select coalesce(gps.total_score,0)::bigint
    into v_value
  from public.player_game_period_stats gps
  where gps.user_id=p_user_id
    and gps.game_id=v_game
    and gps.period_type=v_period_type
    and gps.period_start=v_period_start;

  return coalesce(v_value,0);
end;
$$;


create or replace function public.get_my_brainilab_friends_ranking(
  p_period text default 'daily',
  p_game_id text default 'all',
  p_metric text default 'score'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_period text:=lower(coalesce(p_period,'daily'));
  v_game text:=lower(coalesce(p_game_id,'all'));
  v_metric text:=lower(coalesce(p_metric,'score'));

  v_rows jsonb;
  v_me_row jsonb;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  if v_period not in ('daily','weekly','monthly') then
    raise exception 'Invalid ranking period';
  end if;

  if v_metric not in ('score','streak') then
    raise exception 'Invalid ranking metric';
  end if;

  with members as (
    select v_me as user_id

    union

    select
      case
        when f.user_a=v_me then f.user_b
        else f.user_a
      end
    from public.friendships f
    where f.user_a=v_me or f.user_b=v_me
  ),
  values_by_member as (
    select
      m.user_id,
      p.display_name,
      p.country_code,
      p.avatar_url,

      coalesce(pp.current_streak,0) as streak,

      public.brainilab_player_rank_value(
        m.user_id,
        v_period,
        v_game,
        v_metric
      ) as rank_value

    from members m

    join public.profiles p
      on p.user_id=m.user_id

    left join public.player_progression pp
      on pp.user_id=m.user_id
  ),
  ranked as (
    select
      v.*,
      row_number() over(
        order by
          v.rank_value desc,
          lower(v.display_name),
          v.user_id
      ) as rank
    from values_by_member v
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank',r.rank,
          'user_id',r.user_id,
          'name',r.display_name,
          'country',r.country_code,
          'avatar_url',r.avatar_url,
          'avatar',upper(left(r.display_name,1)),
          'score',r.rank_value,
          'streak',r.streak,
          'level',coalesce((
            select pp2.level
            from public.player_progression pp2
            where pp2.user_id=r.user_id
          ),1),
          'display_value',case
            when v_metric='streak'
              then r.rank_value::text || ' days'
            else to_char(
              r.rank_value,
              'FM999G999G999G990'
            )
          end,
          'is_me',r.user_id=v_me
        )
        order by r.rank
      ),
      '[]'::jsonb
    ),

    (
      select jsonb_build_object(
        'rank',mine.rank,
        'user_id',mine.user_id,
        'name',mine.display_name,
        'country',mine.country_code,
        'avatar_url',mine.avatar_url,
        'avatar',upper(left(mine.display_name,1)),
        'score',mine.rank_value,
        'streak',mine.streak,
        'level',coalesce((
          select pp2.level
          from public.player_progression pp2
          where pp2.user_id=mine.user_id
        ),1),
        'display_value',case
          when v_metric='streak'
            then mine.rank_value::text || ' days'
          else to_char(
            mine.rank_value,
            'FM999G999G999G990'
          )
        end,
        'is_me',true
      )
      from ranked mine
      where mine.user_id=v_me
    )

  into v_rows,v_me_row
  from ranked r;

  return jsonb_build_object(
    'rows',v_rows,
    'user',v_me_row,

    'metric_label',case
      when v_metric='streak' then 'Streak'
      when v_game='all' then 'Brain Score'
      when v_game in (
        'brainmix','flagdash','orderup','maphunt','topicrush','brainiword'
      ) then 'Daily points'
      else 'Points'
    end,

    'total_players',jsonb_array_length(v_rows),
    'period',v_period,
    'game_id',v_game,
    'generated_at',now()
  );
end;
$$;


create or replace function public.get_brainilab_individual_rankings(
  p_region text default 'global',
  p_country_code text default null,
  p_period text default 'daily',
  p_game_id text default 'all',
  p_metric text default 'score',
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();
  v_region text:=lower(coalesce(p_region,'global'));
  v_country text:=upper(nullif(btrim(coalesce(p_country_code,'')),''));
  v_period text:=lower(coalesce(p_period,'daily'));
  v_game text:=lower(coalesce(p_game_id,'all'));
  v_metric text:=lower(coalesce(p_metric,'score'));
  v_limit integer:=least(100,greatest(10,coalesce(p_limit,100)));
  v_my_country text;
  v_my_enabled boolean:=false;
  v_my_public_name text;
  v_rows jsonb;
  v_user jsonb;
  v_total integer:=0;
  v_user_eligible boolean:=false;
begin
  if v_region not in ('global','country') then
    raise exception 'Invalid ranking region';
  end if;

  if v_period not in ('daily','weekly','monthly') then
    raise exception 'Invalid ranking period';
  end if;

  if v_metric not in ('score','streak') then
    raise exception 'Invalid ranking metric';
  end if;

  if v_me is not null then
    select
      p.country_code,
      p.leaderboard_enabled,
      p.leaderboard_display_name
    into
      v_my_country,
      v_my_enabled,
      v_my_public_name
    from public.profiles p
    where p.user_id=v_me;

    if v_country is null then
      v_country:=v_my_country;
    end if;
  end if;

  if v_region='country'
     and (v_country is null or v_country !~ '^[A-Z]{2}$') then
    return jsonb_build_object(
      'rows','[]'::jsonb,
      'user',null,
      'total_players',0,
      'metric_label',case
        when v_metric='streak' then 'Streak'
        when v_game='all' then 'Brain Score'
        when v_game in ('brainmix','flagdash','orderup','maphunt','topicrush','brainiword')
          then 'Daily points'
        else 'Points'
      end,
      'leaderboard_enabled',v_my_enabled,
      'leaderboard_display_name',v_my_public_name,
      'user_eligible',false,
      'country_required',true,
      'my_country',v_my_country,
      'generated_at',now()
    );
  end if;

  with candidates as (
    select
      p.user_id,
      p.leaderboard_display_name as public_name,
      p.country_code,
      p.avatar_url,
      public.brainilab_player_rank_value(
        p.user_id,
        v_period,
        v_game,
        v_metric
      ) as rank_value
    from public.profiles p
    where p.leaderboard_enabled=true
      and p.leaderboard_display_name is not null
      and char_length(btrim(p.leaderboard_display_name))>=2
      and (
        v_region='global'
        or p.country_code=v_country
      )
      and not exists(
        select 1
        from public.admin_ranking_suspensions ars
        where ars.entity_type='user'
          and ars.entity_id=p.user_id
          and ars.active=true
          and (
            ars.expires_at is null
            or ars.expires_at>now()
          )
      )
  ),
  eligible as (
    select *
    from candidates
    where rank_value>0
  ),
  ranked as (
    select
      e.*,
      row_number() over(
        order by
          e.rank_value desc,
          lower(e.public_name),
          e.user_id
      ) as rank
    from eligible e
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank',r.rank,
          'name',r.public_name,
          'country',r.country_code,
          'avatar_url',r.avatar_url,
          'avatar',upper(left(r.public_name,1)),
          'score',r.rank_value,
          'level',coalesce((
            select pp_level.level
            from public.player_progression pp_level
            where pp_level.user_id=r.user_id
          ),1),
          'streak',case
            when v_metric='streak' then r.rank_value
            else (
              select coalesce(pp.current_streak,0)
              from public.player_progression pp
              where pp.user_id=r.user_id
            )
          end,
          'display_value',case
            when v_metric='streak'
              then r.rank_value::text||' days'
            else to_char(r.rank_value,'FM999G999G999G990')
          end,
          'is_me',r.user_id=v_me
        )
        order by r.rank
      ) filter(where r.rank<=v_limit),
      '[]'::jsonb
    ),
    count(*)::integer,
    (
      select jsonb_build_object(
        'rank',mine.rank,
        'name',mine.public_name,
        'country',mine.country_code,
        'avatar_url',mine.avatar_url,
        'avatar',upper(left(mine.public_name,1)),
        'score',mine.rank_value,
        'level',coalesce((
          select pp_level.level
          from public.player_progression pp_level
          where pp_level.user_id=mine.user_id
        ),1),
        'streak',case
          when v_metric='streak' then mine.rank_value
          else (
            select coalesce(pp.current_streak,0)
            from public.player_progression pp
            where pp.user_id=mine.user_id
          )
        end,
        'display_value',case
          when v_metric='streak'
            then mine.rank_value::text||' days'
          else to_char(mine.rank_value,'FM999G999G999G990')
        end,
        'is_me',true
      )
      from ranked mine
      where mine.user_id=v_me
      limit 1
    ),
    exists(
      select 1 from ranked mine
      where mine.user_id=v_me
    )
  into
    v_rows,
    v_total,
    v_user,
    v_user_eligible
  from ranked r;

  return jsonb_build_object(
    'rows',v_rows,
    'user',v_user,
    'total_players',v_total,
    'metric_label',case
      when v_metric='streak' then 'Streak'
      when v_game='all' then 'Brain Score'
      when v_game in ('brainmix','flagdash','orderup','maphunt','topicrush','brainiword')
        then 'Daily points'
      else 'Points'
    end,
    'leaderboard_enabled',v_my_enabled,
    'leaderboard_display_name',v_my_public_name,
    'user_eligible',v_user_eligible,
    'region',v_region,
    'country',v_country,
    'my_country',v_my_country,
    'period',v_period,
    'game_id',v_game,
    'generated_at',now()
  );
end;
$$;


create or replace function public.refresh_brainilab_group_game_rank_stats(
  p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_group_id is null then
    return;
  end if;

  delete from public.group_game_period_stats
  where group_id=p_group_id;

  -- ----------------------------------------------------------
  -- Daily Games: normalized Daily contribution points.
  -- ----------------------------------------------------------

  insert into public.group_game_period_stats(
    group_id,
    game_id,
    period_type,
    period_start,
    member_count,
    active_members,
    group_score,
    eligible,
    top_contributors,
    updated_at
  )
  with members as (
    select gm.user_id
    from public.group_members gm
    where gm.group_id=p_group_id
  ),
  daily_values as (
    select
      ds.user_id,
      games.game_id,
      periods.period_type,
      periods.period_start,

      sum(
        case games.game_id
          when 'brainmix' then ds.brainmix_points
          when 'flagdash' then ds.flagdash_points
          when 'orderup' then ds.orderup_points
          when 'maphunt' then ds.maphunt_points
          when 'topicrush' then case
            when ds.stat_date >= (
              select trs.launch_date
              from public.topic_rush_settings trs
              where trs.singleton=true
            )
              then greatest(ds.topicrush_points,ds.maphunt_points)
            else 0
          end
          when 'brainiword' then ds.brainiword_points
          else 0
        end
      )::bigint as score

    from public.player_daily_stats ds

    join members m
      on m.user_id=ds.user_id

    cross join (
      values
        ('brainmix'::text),
        ('flagdash'::text),
        ('orderup'::text),
        ('maphunt'::text),
        ('topicrush'::text),
        ('brainiword'::text)
    ) games(game_id)

    cross join lateral (
      values
        ('day'::text,ds.stat_date),
        (
          'week'::text,
          date_trunc(
            'week',
            ds.stat_date::timestamp
          )::date
        ),
        (
          'month'::text,
          date_trunc(
            'month',
            ds.stat_date::timestamp
          )::date
        )
    ) periods(period_type,period_start)

    group by
      ds.user_id,
      games.game_id,
      periods.period_type,
      periods.period_start
  ),
  period_keys as (
    select distinct
      dv.game_id,
      dv.period_type,
      dv.period_start
    from daily_values dv
  ),
  ranked as (
    select
      pk.game_id,
      pk.period_type,
      pk.period_start,
      m.user_id,
      p.display_name,
      coalesce(dv.score,0)::bigint as score,

      row_number() over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
        order by
          coalesce(dv.score,0) desc,
          m.user_id
      ) as rn,

      count(*) over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
      )::integer as member_count,

      count(*) filter(
        where coalesce(dv.score,0)>0
      ) over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
      )::integer as active_members

    from period_keys pk
    cross join members m

    join public.profiles p
      on p.user_id=m.user_id

    left join daily_values dv
      on dv.user_id=m.user_id
     and dv.game_id=pk.game_id
     and dv.period_type=pk.period_type
     and dv.period_start=pk.period_start
  )
  select
    p_group_id,
    r.game_id,
    r.period_type,
    r.period_start,
    max(r.member_count),
    max(r.active_members),

    coalesce(
      sum(r.score) filter(where r.rn<=3),
      0
    )::bigint,

    max(r.member_count)>=3,

    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id',r.user_id,
          'name',r.display_name,
          'score',r.score
        )
        order by r.rn
      ) filter(where r.rn<=3),
      '[]'::jsonb
    ),

    now()

  from ranked r

  group by
    r.game_id,
    r.period_type,
    r.period_start;


  -- ----------------------------------------------------------
  -- Evergreen games: accumulated raw score.
  -- ----------------------------------------------------------

  insert into public.group_game_period_stats(
    group_id,
    game_id,
    period_type,
    period_start,
    member_count,
    active_members,
    group_score,
    eligible,
    top_contributors,
    updated_at
  )
  with members as (
    select gm.user_id
    from public.group_members gm
    where gm.group_id=p_group_id
  ),
  period_keys as (
    select distinct
      gps.game_id,
      gps.period_type,
      gps.period_start
    from public.player_game_period_stats gps
    join members m
      on m.user_id=gps.user_id
    where gps.game_id not in (
      'brainmix','flagdash','orderup','maphunt','topicrush','brainiword'
    )
  ),
  ranked as (
    select
      pk.game_id,
      pk.period_type,
      pk.period_start,
      m.user_id,
      p.display_name,
      coalesce(gps.total_score,0)::bigint as score,

      row_number() over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
        order by
          coalesce(gps.total_score,0) desc,
          m.user_id
      ) as rn,

      count(*) over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
      )::integer as member_count,

      count(*) filter(
        where coalesce(gps.games_played,0)>0
      ) over(
        partition by
          pk.game_id,
          pk.period_type,
          pk.period_start
      )::integer as active_members

    from period_keys pk
    cross join members m

    join public.profiles p
      on p.user_id=m.user_id

    left join public.player_game_period_stats gps
      on gps.user_id=m.user_id
     and gps.game_id=pk.game_id
     and gps.period_type=pk.period_type
     and gps.period_start=pk.period_start
  )
  select
    p_group_id,
    r.game_id,
    r.period_type,
    r.period_start,
    max(r.member_count),
    max(r.active_members),

    coalesce(
      sum(r.score) filter(where r.rn<=3),
      0
    )::bigint,

    max(r.member_count)>=3,

    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id',r.user_id,
          'name',r.display_name,
          'score',r.score
        )
        order by r.rn
      ) filter(where r.rn<=3),
      '[]'::jsonb
    ),

    now()

  from ranked r

  group by
    r.game_id,
    r.period_type,
    r.period_start;
end;
$$;


create or replace function public.get_brainilab_group_rankings(
  p_region text default 'global',
  p_country_code text default null,
  p_period text default 'daily',
  p_game_id text default 'all',
  p_metric text default 'score',
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_me uuid:=auth.uid();

  v_region text:=lower(coalesce(p_region,'global'));
  v_country text:=upper(
    nullif(btrim(coalesce(p_country_code,'')),'')
  );
  v_period text:=lower(coalesce(p_period,'daily'));
  v_game text:=lower(coalesce(p_game_id,'all'));
  v_metric text:=lower(coalesce(p_metric,'score'));

  v_today date:=(now() at time zone 'UTC')::date;
  v_week date:=date_trunc(
    'week',
    (now() at time zone 'UTC')
  )::date;
  v_month date:=date_trunc(
    'month',
    (now() at time zone 'UTC')
  )::date;

  v_period_type text;
  v_period_start date;

  v_limit integer:=least(
    100,
    greatest(10,coalesce(p_limit,100))
  );

  v_rows jsonb;
  v_user jsonb;
  v_my_groups jsonb;
  v_total integer;
begin
  if v_me is null then
    raise exception 'Authentication required';
  end if;

  if v_region not in ('global','country') then
    raise exception 'Invalid group ranking region';
  end if;

  if v_period not in ('daily','weekly','monthly') then
    raise exception 'Invalid group ranking period';
  end if;

  if v_metric not in ('score','streak') then
    raise exception 'Invalid group ranking metric';
  end if;

  if v_region='country'
     and (v_country is null or v_country !~ '^[A-Z]{2}$') then

    return jsonb_build_object(
      'rows','[]'::jsonb,
      'user',null,
      'my_groups','[]'::jsonb,
      'total_players',0,
      'metric_label',case
        when v_metric='streak' then 'Group streak'
        when v_game='all' then 'Group Brain Score'
        when v_game in (
          'brainmix','flagdash','orderup','maphunt','topicrush','brainiword'
        ) then 'Group Daily points'
        else 'Group points'
      end,
      'country_required',true
    );
  end if;

  if v_period='daily' then
    v_period_type:='day';
    v_period_start:=v_today;
  elsif v_period='weekly' then
    v_period_type:='week';
    v_period_start:=v_week;
  else
    v_period_type:='month';
    v_period_start:=v_month;
  end if;

  with group_base as (
    select
      g.id,
      g.name,
      g.country_code,
      g.crest_icon,
      g.crest_color,

      (
        select count(*)::integer
        from public.group_members gm
        where gm.group_id=g.id
      ) as member_count,

      exists(
        select 1
        from public.group_members mine
        where mine.group_id=g.id
          and mine.user_id=v_me
      ) as is_mine

    from public.groups g

    where g.status='active'
      and (
        v_region='global'
        or g.country_code=v_country
      )
      and not exists(
        select 1
        from public.admin_ranking_suspensions ars
        where ars.entity_type='group'
          and ars.entity_id=g.id
          and ars.active=true
          and (
            ars.expires_at is null
            or ars.expires_at>now()
          )
      )
  ),
  scored as (
    select
      gb.*,

      case
        when v_metric='streak'
          then public.brainilab_group_current_streak(
            gb.id
          )::bigint

        when v_game='all'
             and v_period='daily'
          then coalesce(gds.group_score,0)

        when v_game='all'
             and v_period in ('weekly','monthly')
          then coalesce(gps.group_score,0)

        else coalesce(ggps.group_score,0)
      end as score

    from group_base gb

    left join public.group_daily_stats gds
      on gds.group_id=gb.id
     and gds.stat_date=v_today

    left join public.group_period_stats gps
      on gps.group_id=gb.id
     and gps.period_type=case
       when v_period='weekly' then 'week'
       else 'month'
     end
     and gps.period_start=case
       when v_period='weekly' then v_week
       else v_month
     end

    left join public.group_game_period_stats ggps
      on ggps.group_id=gb.id
     and ggps.game_id=v_game
     and ggps.period_type=v_period_type
     and ggps.period_start=v_period_start

    where gb.member_count>=3
  ),
  eligible as (
    select *
    from scored
    where score>0
  ),
  ranked as (
    select
      s.*,
      row_number() over(
        order by
          s.score desc,
          lower(s.name),
          s.id
      ) as rank
    from eligible s
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank',r.rank,
          'group_id',r.id,
          'name',r.name,
          'country',r.country_code,

          'crest',jsonb_build_object(
            'icon',r.crest_icon,
            'color',r.crest_color
          ),

          'members',r.member_count,
          'score',r.score,

          'streak',case
            when v_metric='streak' then r.score
            else public.brainilab_group_current_streak(
              r.id
            )
          end,

          'display_value',case
            when v_metric='streak'
              then r.score::text || ' days'
            else to_char(
              r.score,
              'FM999G999G999G990'
            )
          end,

          'is_me',r.is_mine
        )
        order by r.rank
      ) filter(where r.rank<=v_limit),
      '[]'::jsonb
    ),

    count(*)::integer,

    (
      select jsonb_build_object(
        'rank',mine.rank,
        'group_id',mine.id,
        'name',mine.name,
        'country',mine.country_code,

        'crest',jsonb_build_object(
          'icon',mine.crest_icon,
          'color',mine.crest_color
        ),

        'members',mine.member_count,
        'score',mine.score,

        'streak',case
          when v_metric='streak' then mine.score
          else public.brainilab_group_current_streak(
            mine.id
          )
        end,

        'display_value',case
          when v_metric='streak'
            then mine.score::text || ' days'
          else to_char(
            mine.score,
            'FM999G999G999G990'
          )
        end,

        'is_me',true
      )
      from ranked mine
      where mine.is_mine=true
      order by mine.rank
      limit 1
    )

  into v_rows,v_total,v_user
  from ranked r;


  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'group_id',g.id,
        'name',g.name,
        'country',g.country_code,

        'crest',jsonb_build_object(
          'icon',g.crest_icon,
          'color',g.crest_color
        ),

        'members',(
          select count(*)
          from public.group_members cgm
          where cgm.group_id=g.id
        ),

        'eligible',(
          select count(*)>=3
          from public.group_members cgm
          where cgm.group_id=g.id
        )
      )
      order by g.created_at desc
    ),
    '[]'::jsonb
  )
  into v_my_groups
  from public.group_members gm
  join public.groups g
    on g.id=gm.group_id
   and g.status='active'
  where gm.user_id=v_me;


  return jsonb_build_object(
    'rows',v_rows,
    'user',v_user,
    'my_groups',v_my_groups,
    'total_players',v_total,

    'metric_label',case
      when v_metric='streak' then 'Group streak'
      when v_game='all' then 'Group Brain Score'
      when v_game in (
        'brainmix','flagdash','orderup','maphunt','topicrush','brainiword'
      ) then 'Group Daily points'
      else 'Group points'
    end,

    'period',v_period,
    'game_id',v_game,
    'region',v_region,
    'country',v_country,
    'generated_at',now()
  );
end;
$$;


create or replace function public.admin_set_brainilab_runtime_flag(
  p_flag_key text,
  p_enabled boolean,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner']::text[]
  );

  if p_flag_key not in (
    'brainmix_enabled','flagdash_enabled','orderup_enabled','topicrush_enabled',
    'brainiword_enabled','rankings_enabled','groups_enabled',
    'maintenance_enabled'
  ) then
    raise exception 'Invalid runtime flag';
  end if;

  update public.runtime_flags
  set
    enabled=p_enabled,
    message=nullif(left(btrim(coalesce(p_message,'')),500),''),
    updated_by=v_uid,
    updated_at=now()
  where flag_key=p_flag_key;

  perform public.log_brainilab_admin_action(
    'RUNTIME_FLAG_UPDATED',
    'runtime_flag',
    p_flag_key,
    jsonb_build_object(
      'enabled',p_enabled,
      'message',nullif(left(btrim(coalesce(p_message,'')),500),'')
    )
  );

  return (
    select jsonb_build_object(
      'flag_key',rf.flag_key,
      'enabled',rf.enabled,
      'message',rf.message,
      'updated_at',rf.updated_at
    )
    from public.runtime_flags rf
    where rf.flag_key=p_flag_key
  );
end;
$$;


-- ============================================================
-- ADMIN — Topic Rush operations
-- ============================================================




-- ============================================================
-- RUNTIME FLAG
-- ============================================================

alter table public.runtime_flags
  drop constraint if exists runtime_flags_key_check;

alter table public.runtime_flags
  add constraint runtime_flags_key_check
  check(flag_key in (
    'brainmix_enabled',
    'flagdash_enabled',
    'orderup_enabled',
    'topicrush_enabled',
    'brainiword_enabled',
    'rankings_enabled',
    'groups_enabled',
    'maintenance_enabled'
  ));

insert into public.runtime_flags(
  flag_key,enabled,message
)
values(
  'orderup_enabled',true,null
)
on conflict(flag_key)
do update set
  enabled=true,
  updated_at=now();


-- ============================================================
-- ADMIN — ORDER UP
-- ============================================================

create or replace function public.admin_get_order_up_daily(
  p_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_uid uuid;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner','editor']::text[]
  );

  return (
    select jsonb_build_object(
      'daily_challenge_id',dc.id,
      'daily_number',dc.daily_number,
      'date',dc.challenge_date,
      'count',(
        select count(*)
        from public.daily_order_up_rounds dour
        where dour.daily_challenge_id=dc.id
      ),
      'rounds',(
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'round_id',our.id,
              'position',dour.position,
              'external_key',our.external_key,
              'title',our.title,
              'prompt',our.prompt,
              'direction_label',our.direction_label,
              'category',our.category,
              'items',(
                select coalesce(
                  jsonb_agg(
                    jsonb_build_object(
                      'position',oui.sort_position,
                      'label',oui.label
                    )
                    order by oui.sort_position
                  ),
                  '[]'::jsonb
                )
                from public.order_up_items oui
                where oui.round_id=our.id
              )
            )
            order by dour.position
          ),
          '[]'::jsonb
        )
        from public.daily_order_up_rounds dour
        join public.order_up_rounds our
          on our.id=dour.round_id
        where dour.daily_challenge_id=dc.id
      )
    )
    from public.daily_challenges dc
    where dc.challenge_date=p_date
    limit 1
  );
end;
$$;

revoke execute on function public.admin_get_order_up_daily(date)
  from public,anon;

grant execute on function public.admin_get_order_up_daily(date)
  to authenticated;


create or replace function public.admin_list_order_up_rounds()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_uid uuid;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner','editor']::text[]
  );

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',our.id,
          'external_key',our.external_key,
          'title',our.title,
          'prompt',our.prompt,
          'direction_label',our.direction_label,
          'category',our.category,
          'active',our.is_active,
          'item_count',(
            select count(*)
            from public.order_up_items oui
            where oui.round_id=our.id
          ),
          'last_used',(
            select max(dc.challenge_date)
            from public.daily_order_up_rounds dour
            join public.daily_challenges dc
              on dc.id=dour.daily_challenge_id
            where dour.round_id=our.id
          )
        )
        order by
          our.is_active desc,
          our.category,
          our.title
      ),
      '[]'::jsonb
    )
    from public.order_up_rounds our
  );
end;
$$;

revoke execute on function public.admin_list_order_up_rounds()
  from public,anon;

grant execute on function public.admin_list_order_up_rounds()
  to authenticated;


create or replace function public.admin_create_order_up_round(
  p_external_key text,
  p_title text,
  p_prompt text,
  p_direction_label text,
  p_category text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid;
  v_round_id uuid;
  v_item jsonb;
  v_position integer:=0;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner','editor']::text[]
  );

  if char_length(btrim(coalesce(p_external_key,'')))<3 then
    raise exception 'External key is required';
  end if;

  if char_length(btrim(coalesce(p_title,'')))<3 then
    raise exception 'Title is required';
  end if;

  if char_length(btrim(coalesce(p_prompt,'')))<3 then
    raise exception 'Prompt is required';
  end if;

  if char_length(btrim(coalesce(p_direction_label,'')))<3 then
    raise exception 'Direction label is required';
  end if;

  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array'
     or jsonb_array_length(p_items)<>10 then
    raise exception 'Order Up requires exactly 10 items';
  end if;

  if exists(
    select 1
    from jsonb_array_elements(p_items) x(value)
    where char_length(btrim(coalesce(x.value#>>'{}','')))<1
  ) then
    raise exception 'All 10 Order Up items need text';
  end if;

  if (
    select count(distinct lower(btrim(x.value#>>'{}')))
    from jsonb_array_elements(p_items) x(value)
  )<>10 then
    raise exception 'Order Up items must be unique';
  end if;

  insert into public.order_up_rounds(
    external_key,
    title,
    prompt,
    direction_label,
    category,
    is_active
  )
  values(
    lower(btrim(p_external_key)),
    btrim(p_title),
    btrim(p_prompt),
    btrim(p_direction_label),
    lower(btrim(coalesce(p_category,'general'))),
    true
  )
  returning id into v_round_id;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_position:=v_position+1;

    insert into public.order_up_items(
      round_id,
      sort_position,
      label
    )
    values(
      v_round_id,
      v_position,
      btrim(v_item#>>'{}')
    );
  end loop;

  perform public.log_brainilab_admin_action(
    'ORDER_UP_ROUND_CREATED',
    'order_up_round',
    v_round_id::text,
    jsonb_build_object(
      'external_key',lower(btrim(p_external_key)),
      'category',lower(btrim(coalesce(p_category,'general')))
    )
  );

  return jsonb_build_object(
    'ok',true,
    'round_id',v_round_id
  );
end;
$$;

revoke execute on function public.admin_create_order_up_round(
  text,text,text,text,text,jsonb
) from public,anon;

grant execute on function public.admin_create_order_up_round(
  text,text,text,text,text,jsonb
) to authenticated;


create or replace function public.admin_toggle_order_up_round(
  p_round_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid;
  v_active_count integer;
begin
  v_uid:=public.require_brainilab_admin(
    array['owner','editor']::text[]
  );

  if p_active=false then
    select count(*)::integer
      into v_active_count
    from public.order_up_rounds
    where is_active=true
      and id<>p_round_id;

    if v_active_count<30 then
      raise exception
        'Keep at least 30 active Order Up rounds for the 14-day two-round rotation';
    end if;
  end if;

  update public.order_up_rounds
  set
    is_active=p_active,
    updated_at=now()
  where id=p_round_id;

  if not found then
    raise exception 'Order Up round not found';
  end if;

  perform public.log_brainilab_admin_action(
    'ORDER_UP_ROUND_TOGGLED',
    'order_up_round',
    p_round_id::text,
    jsonb_build_object('active',p_active)
  );

  return jsonb_build_object(
    'ok',true,
    'round_id',p_round_id,
    'active',p_active
  );
end;
$$;

revoke execute on function public.admin_toggle_order_up_round(uuid,boolean)
  from public,anon;

grant execute on function public.admin_toggle_order_up_round(uuid,boolean)
  to authenticated;


-- ============================================================
-- RLS / DIRECT ACCESS
-- ============================================================

alter table public.order_up_settings enable row level security;
alter table public.order_up_rounds enable row level security;
alter table public.order_up_items enable row level security;
alter table public.daily_order_up_rounds enable row level security;

revoke all on table public.order_up_settings
  from anon,authenticated;

revoke all on table public.order_up_rounds
  from anon,authenticated;

revoke all on table public.order_up_items
  from anon,authenticated;

revoke all on table public.daily_order_up_rounds
  from anon,authenticated;


-- ============================================================
-- REBUILD CURRENT DERIVED PROGRESSION / GROUP AGGREGATES
-- ============================================================

do $$
declare
  v_user record;
  v_group record;
begin
  for v_user in
    select pp.user_id
    from public.player_progression pp
  loop
    perform public.refresh_brainilab_player_progression(
      v_user.user_id
    );
  end loop;

  for v_group in
    select g.id
    from public.groups g
    where g.status='active'
  loop
    perform public.refresh_brainilab_group_stats(v_group.id);
    perform public.refresh_brainilab_group_game_rank_stats(v_group.id);
  end loop;
end;
$$;


commit;

-- Verify Order Up Daily:
--
-- select
--   dc.challenge_date,
--   dc.daily_number,
--   count(dour.round_id) as order_up_rounds
-- from public.daily_challenges dc
-- left join public.daily_order_up_rounds dour
--   on dour.daily_challenge_id=dc.id
-- where dc.challenge_date>=current_date
-- group by dc.challenge_date,dc.daily_number
-- order by dc.challenge_date;
--
-- Expected: 2 Order Up rounds for today and every generated future Daily.
--
-- Verify pool:
--
-- select
--   count(*) filter(where is_active) as active_rounds
-- from public.order_up_rounds;
--
-- Expected: >= 30.
--
-- Verify RPC:
--
-- select
--   to_regprocedure('public.get_brainilab_daily_order_up()') as get_order_up,
--   to_regprocedure(
--     'public.check_brainilab_order_up_round(uuid,uuid,jsonb)'
--   ) as check_order_up,
--   to_regprocedure(
--     'public.verify_brainilab_order_up_result(text,uuid,jsonb)'
--   ) as verify_order_up;
